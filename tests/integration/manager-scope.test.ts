import { describe, it, expect, beforeAll } from 'vitest';
import { api, loginAs, loginWithCredentials, authHeader } from '../helpers/http';
import {
  createTrack,
  createTask,
  createProject,
  createTestUser,
  assignTrackToUser,
  getExecutionsForAssignment,
} from '../helpers/factories';

/**
 * Modelo de visibilidade: `admin`/`hr` veem tudo (administração técnica);
 * `leadership` (gestor/gerente) só o que foi direcionado a ele — trilhas
 * institucionais ou de projetos onde é `manager`; `employee` só o que foi
 * direcionado a ele — trilhas às quais tem uma atribuição. Ver
 * `src/utils/manager-scope.ts`.
 */
describe('Escopo de visibilidade por perfil (managers de projeto)', () => {
  let adminToken: string;
  let adminId: number;

  // Dois projetos, dois gerentes — cada um só deve enxergar o seu.
  let projectA: { id: number; documentId: string; name: string };
  let projectB: { id: number; documentId: string; name: string };
  let trackA: { id: number; documentId: string };
  let trackB: { id: number; documentId: string };
  let institutionalTrack: { id: number; documentId: string };
  let managerAToken: string;
  let managerBToken: string;
  let managerNoneToken: string; // leadership sem nenhum projeto

  beforeAll(async () => {
    ({ token: adminToken, userId: adminId } = await loginAs('admin'));

    trackA = await createTrack({ track_type: 'project', name: `Trilha A ${Date.now()}` });
    trackB = await createTrack({ track_type: 'project', name: `Trilha B ${Date.now()}` });
    institutionalTrack = await createTrack({ track_type: 'institutional' });

    const managerA = await createTestUser({ role: 'leadership' });
    const managerB = await createTestUser({ role: 'leadership' });
    const managerNone = await createTestUser({ role: 'leadership' });

    projectA = await createProject({ managers: [managerA.id], tracks: [trackA.id] });
    projectB = await createProject({ managers: [managerB.id], tracks: [trackB.id] });

    ({ token: managerAToken } = await loginWithCredentials(managerA.email, managerA.plainPassword));
    ({ token: managerBToken } = await loginWithCredentials(managerB.email, managerB.plainPassword));
    ({ token: managerNoneToken } = await loginWithCredentials(managerNone.email, managerNone.plainPassword));
  });

  describe('Projetos', () => {
    it('admin/hr veem todos os projetos', async () => {
      const client = await api();
      const res = await client.get('/api/projects?pagination[pageSize]=200').set(authHeader(adminToken));
      const ids = res.body.data.map((p: { id: number }) => p.id);
      expect(ids).toEqual(expect.arrayContaining([projectA.id, projectB.id]));
    });

    it('gerente só vê os projetos onde é manager', async () => {
      const client = await api();
      const res = await client.get('/api/projects?pagination[pageSize]=200').set(authHeader(managerAToken));
      const ids = res.body.data.map((p: { id: number }) => p.id);
      expect(ids).toContain(projectA.id);
      expect(ids).not.toContain(projectB.id);
    });

    it('gerente sem projeto não vê nenhum', async () => {
      const client = await api();
      const res = await client.get('/api/projects?pagination[pageSize]=200').set(authHeader(managerNoneToken));
      const ids = res.body.data.map((p: { id: number }) => p.id);
      expect(ids).not.toContain(projectA.id);
      expect(ids).not.toContain(projectB.id);
    });

    it('gerente pedindo findOne de um projeto fora do escopo recebe 404 (não 403)', async () => {
      const client = await api();
      const res = await client
        .get(`/api/projects/${projectB.documentId}`)
        .set(authHeader(managerAToken));
      expect(res.status).toBe(404);
    });

    it('gerente pedindo findOne do próprio projeto funciona normalmente', async () => {
      const client = await api();
      const res = await client
        .get(`/api/projects/${projectA.documentId}`)
        .set(authHeader(managerAToken));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(projectA.id);
    });
  });

  describe('Trilhas', () => {
    it('admin/hr veem todas as trilhas', async () => {
      // Filtra pelos ids específicos: o schema de teste acumula trilhas de
      // execuções anteriores desta suíte, então nem paginação grande garante
      // que as 3 desta execução apareçam por padrão.
      const wantedIds = [trackA.id, trackB.id, institutionalTrack.id];
      const client = await api();
      const res = await client
        .get(`/api/tracks?filters[id][$in]=${wantedIds.join('&filters[id][$in]=')}`)
        .set(authHeader(adminToken));
      const ids = res.body.data.map((t: { id: number }) => t.id);
      expect(ids).toEqual(expect.arrayContaining(wantedIds));
    });

    it('gerente vê a trilha do seu projeto e as institucionais, não a de outro projeto', async () => {
      // Restringe a resposta do servidor (já filtrada pelo escopo) a estas 3
      // trilhas específicas — evita que dados acumulados de execuções
      // anteriores da suíte escondam o resultado numa página maior.
      const candidateIds = [trackA.id, trackB.id, institutionalTrack.id];
      const client = await api();
      const res = await client
        .get(`/api/tracks?filters[id][$in]=${candidateIds.join('&filters[id][$in]=')}`)
        .set(authHeader(managerAToken));
      const ids = res.body.data.map((t: { id: number }) => t.id);
      expect(ids).toContain(trackA.id);
      expect(ids).toContain(institutionalTrack.id);
      expect(ids).not.toContain(trackB.id);
    });

    it('gerente sem projeto ainda vê as trilhas institucionais', async () => {
      const candidateIds = [trackA.id, trackB.id, institutionalTrack.id];
      const client = await api();
      const res = await client
        .get(`/api/tracks?filters[id][$in]=${candidateIds.join('&filters[id][$in]=')}`)
        .set(authHeader(managerNoneToken));
      const ids = res.body.data.map((t: { id: number }) => t.id);
      expect(ids).toContain(institutionalTrack.id);
      expect(ids).not.toContain(trackA.id);
      expect(ids).not.toContain(trackB.id);
    });

    it('GET /tracks/:id/details de uma trilha fora do escopo: 404 TRACK_NOT_FOUND', async () => {
      const client = await api();
      const res = await client
        .get(`/api/tracks/${trackB.documentId}/details`)
        .set(authHeader(managerAToken));
      expect(res.status).toBe(404);
      expect(res.body.error.details.code).toBe('TRACK_NOT_FOUND');
    });

    it('GET /tracks/:id/details institucional funciona pra qualquer gerente', async () => {
      const client = await api();
      const res = await client
        .get(`/api/tracks/${institutionalTrack.documentId}/details`)
        .set(authHeader(managerNoneToken));
      expect(res.status).toBe(200);
    });
  });

  describe('Atribuições — leitura e escrita', () => {
    let employeeA: { id: number };
    let assignmentA: { id: number; documentId: string };

    beforeAll(async () => {
      employeeA = await createTestUser({ role: 'employee' });
      assignmentA = await assignTrackToUser(trackA.id, employeeA.id, adminId);
    });

    it('gerente só lista atribuições de trilhas do seu projeto', async () => {
      const client = await api();
      const res = await client.get('/api/track-assignments?pagination[pageSize]=200').set(authHeader(managerAToken));
      const ids = res.body.data.map((a: { id: number }) => a.id);
      expect(ids).toContain(assignmentA.id);
    });

    it('outro gerente não vê essa atribuição', async () => {
      const client = await api();
      const res = await client.get('/api/track-assignments?pagination[pageSize]=200').set(authHeader(managerBToken));
      const ids = res.body.data.map((a: { id: number }) => a.id);
      expect(ids).not.toContain(assignmentA.id);
    });

    it('gerente consegue atribuir uma trilha do PRÓPRIO projeto a um colaborador', async () => {
      const employee = await createTestUser({ role: 'employee' });
      const client = await api();
      const res = await client
        .post('/api/track-assignments')
        .set(authHeader(managerAToken))
        .send({ data: { track: trackA.id, user: employee.id } });
      expect(res.status).toBe(201);
    });

    it('gerente NÃO consegue atribuir uma trilha de OUTRO projeto', async () => {
      const employee = await createTestUser({ role: 'employee' });
      const client = await api();
      const res = await client
        .post('/api/track-assignments')
        .set(authHeader(managerAToken))
        .send({ data: { track: trackB.id, user: employee.id } });
      expect(res.status).toBe(403);
      expect(res.body.error.details?.code ?? res.body.error.name).toMatch(
        /TRACK_OUTSIDE_MANAGED_SCOPE|ForbiddenError/,
      );
    });

    it('gerente consegue atribuir uma trilha institucional normalmente', async () => {
      const employee = await createTestUser({ role: 'employee' });
      const client = await api();
      const res = await client
        .post('/api/track-assignments')
        .set(authHeader(managerAToken))
        .send({ data: { track: institutionalTrack.id, user: employee.id } });
      expect(res.status).toBe(201);
    });
  });

  describe('Aprovações — leitura e escrita', () => {
    async function setupSubmittedExecution(track: { id: number }) {
      const task = await createTask(track.id, { requires_manual_approval: true });
      const employee = await createTestUser({ role: 'employee' });
      const { token: employeeToken } = await loginWithCredentials(employee.email, employee.plainPassword);
      const assignment = await assignTrackToUser(track.id, employee.id, adminId);
      const executions = await getExecutionsForAssignment(assignment.id);
      const exec = executions.find((e: any) => e.task_source_document_id === task.documentId)!;

      const client = await api();
      await client.post(`/api/task-executions/${exec.documentId}/complete`).set(authHeader(employeeToken));

      return exec.documentId as string;
    }

    it('gerente só vê, na fila de pendentes, execuções de trilhas do seu projeto', async () => {
      const execA = await setupSubmittedExecution(trackA);
      const execB = await setupSubmittedExecution(trackB);

      const client = await api();
      const res = await client
        .get('/api/task-executions?filters[execution_status][$eq]=submitted&pagination[pageSize]=200')
        .set(authHeader(managerAToken));
      const documentIds = res.body.data.map((e: { documentId: string }) => e.documentId);

      expect(documentIds).toContain(execA);
      expect(documentIds).not.toContain(execB);
    });

    it('gerente consegue aprovar uma execução do PRÓPRIO projeto', async () => {
      const execId = await setupSubmittedExecution(trackA);
      const client = await api();
      const res = await client
        .post(`/api/task-executions/${execId}/approve`)
        .set(authHeader(managerAToken))
        .send({ data: { review_feedback: 'Ok' } });
      expect(res.status).toBe(200);
    });

    it('gerente NÃO consegue aprovar uma execução de OUTRO projeto', async () => {
      const execId = await setupSubmittedExecution(trackB);
      const client = await api();
      const res = await client
        .post(`/api/task-executions/${execId}/approve`)
        .set(authHeader(managerAToken))
        .send({ data: { review_feedback: 'Ok' } });
      expect(res.status).toBe(403);
    });
  });

  describe('Colaborador (employee) — só o que foi atribuído a ele', () => {
    it('sem nenhuma atribuição, não vê nenhuma trilha na listagem geral', async () => {
      const employee = await createTestUser({ role: 'employee' });
      const { token } = await loginWithCredentials(employee.email, employee.plainPassword);

      const client = await api();
      const res = await client.get('/api/tracks').set(authHeader(token));
      const ids = res.body.data.map((t: { id: number }) => t.id);
      expect(ids).not.toContain(trackA.id);
      expect(ids).not.toContain(institutionalTrack.id);
    });

    it('com uma atribuição, vê só a trilha atribuída — nem a institucional nem a de outro projeto', async () => {
      const employee = await createTestUser({ role: 'employee' });
      await assignTrackToUser(trackA.id, employee.id, adminId);
      const { token } = await loginWithCredentials(employee.email, employee.plainPassword);

      const client = await api();
      const res = await client.get('/api/tracks').set(authHeader(token));
      const ids = res.body.data.map((t: { id: number }) => t.id);
      expect(ids).toEqual([trackA.id]);

      const projectsRes = await client.get('/api/projects').set(authHeader(token));
      const projectIds = projectsRes.body.data.map((p: { id: number }) => p.id);
      expect(projectIds).toContain(projectA.id);
      expect(projectIds).not.toContain(projectB.id);
    });
  });
});
