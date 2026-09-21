import { describe, it, expect } from 'vitest';
import { validateAiResult, MAX_TASKS } from '../../src/api/ai-suggestion/services/ai-result-validator';

const task = (overrides: Record<string, unknown> = {}) => ({
  title: 'Ler o guia',
  description: 'desc',
  action_type: 'reading',
  requires_evidence: false,
  requires_manual_approval: false,
  depends_on: [],
  ...overrides,
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  track: { name: 'Trilha X', description: 'd', track_type: 'project' },
  tasks: [task(), task({ title: 'Praticar', depends_on: [1] })],
  ...overrides,
});

const validate = (value: unknown, options: Partial<Parameters<typeof validateAiResult>[1]> = {}) =>
  validateAiResult(typeof value === 'string' ? value : JSON.stringify(value), {
    trackType: 'institutional',
    ...options,
  });

const issuesOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error: any) {
    return { code: error.code, issues: error.details?.issues as Array<{ path: string; message: string }> };
  }
  return null;
};

describe('validateAiResult — fronteira de confiança da saída da IA', () => {
  it('aceita uma estrutura válida e normaliza order_index pela posição', () => {
    const { structure, warnings } = validate(payload());
    expect(structure.track).toEqual({ name: 'Trilha X', description: 'd', track_type: 'project' });
    expect(structure.tasks.map((t) => t.order_index)).toEqual([1, 2]);
    expect(structure.tasks[1].depends_on).toEqual([1]);
    expect(warnings).toEqual([]);
  });

  it('ignora order_index vindo da IA e descarta campos desconhecidos (whitelist)', () => {
    const { structure } = validate(
      payload({ tasks: [task({ order_index: 99, is_admin: true, external_link: 'http://x' })] }),
    );
    expect(structure.tasks[0].order_index).toBe(1);
    expect(structure.tasks[0]).not.toHaveProperty('is_admin');
    expect(structure.tasks[0]).not.toHaveProperty('external_link');
  });

  it('aceita JSON dentro de cerca markdown e com texto ao redor', () => {
    expect(validate('```json\n' + JSON.stringify(payload()) + '\n```').structure.tasks).toHaveLength(2);
    expect(validate('Aqui está: ' + JSON.stringify(payload()) + ' Espero ajudar!').structure.tasks).toHaveLength(2);
  });

  it.each([
    ['texto sem JSON', 'não consegui gerar'],
    ['JSON quebrado', '{"track": {"name": '],
    ['array no topo', '[1,2,3]'],
  ])('rejeita %s com AI_RESULT_INVALID', (_label, raw) => {
    expect(issuesOf(() => validate(raw))?.code).toBe('AI_RESULT_INVALID');
  });

  it('rejeita trilha sem nome, sem tarefas e nome/título longos demais', () => {
    expect(issuesOf(() => validate(payload({ track: { name: '  ' } })))?.issues[0].path).toBe('track.name');
    expect(issuesOf(() => validate(payload({ tasks: [] })))?.issues[0].path).toBe('tasks');
    expect(issuesOf(() => validate(payload({ track: { name: 'x'.repeat(121) } })))?.issues[0].path).toBe('track.name');
    expect(
      issuesOf(() => validate(payload({ tasks: [task({ title: 'x'.repeat(151) })] })))?.issues[0].path,
    ).toBe('tasks[0].title');
  });

  it(`rejeita mais de ${MAX_TASKS} tarefas`, () => {
    const many = Array.from({ length: MAX_TASKS + 1 }, (_, i) => task({ title: `T${i}` }));
    expect(issuesOf(() => validate(payload({ tasks: many })))?.issues[0].path).toBe('tasks');
  });

  it('rejeita action_type fora da lista (inclui external_link, que exigiria URL inexistente)', () => {
    expect(
      issuesOf(() => validate(payload({ tasks: [task({ action_type: 'external_link' })] })))?.issues[0].path,
    ).toBe('tasks[0].action_type');
  });

  it('aplica a regra do backend: dependência só de tarefa estritamente anterior', () => {
    // própria posição, posterior, zero, não inteiro e repetida
    for (const bad of [[1], [2], [0], [1.5], ['1']]) {
      const result = issuesOf(() => validate(payload({ tasks: [task({ depends_on: bad })] })));
      expect(result?.issues[0].path).toBe('tasks[0].depends_on');
    }
    const repeated = issuesOf(() =>
      validate(payload({ tasks: [task(), task({ depends_on: [1, 1] })] })),
    );
    expect(repeated?.issues[0].message).toContain('repetida');
  });

  it('depends_on que não é lista é rejeitado; ausente vira lista vazia', () => {
    expect(issuesOf(() => validate(payload({ tasks: [task({ depends_on: 'x' })] })))?.issues[0].path).toBe(
      'tasks[0].depends_on',
    );
    const { structure } = validate(payload({ tasks: [{ title: 'Só título' }] }));
    expect(structure.tasks[0]).toMatchObject({
      depends_on: [],
      action_type: 'reading',
      requires_evidence: false,
      requires_manual_approval: false,
    });
  });

  it('booleans só são verdadeiros quando === true (string "true" não vale)', () => {
    const { structure } = validate(
      payload({ tasks: [task({ requires_evidence: 'true', requires_manual_approval: true })] }),
    );
    expect(structure.tasks[0].requires_evidence).toBe(false);
    expect(structure.tasks[0].requires_manual_approval).toBe(true);
  });

  it('usa o track_type do pedido quando a IA omite ou devolve valor inválido', () => {
    expect(validate(payload({ track: { name: 'X' } })).structure.track.track_type).toBe('institutional');
    expect(validate(payload({ track: { name: 'X', track_type: 'hack' } })).structure.track.track_type).toBe(
      'institutional',
    );
  });

  it('remove caracteres de controle mas preserva quebras de linha', () => {
    const nul = String.fromCharCode(0);
    const bell = String.fromCharCode(7);
    const { structure } = validate(
      payload({ tasks: [task({ title: `A${nul}B`, description: `l1\nl2${bell}` })] }),
    );
    expect(structure.tasks[0].title).toBe('AB');
    expect(structure.tasks[0].description).toBe('l1\nl2');
  });

  it('limita a quantidade de problemas reportados', () => {
    const many = Array.from({ length: MAX_TASKS }, () => task({ title: '', action_type: 'x' }));
    expect(issuesOf(() => validate(payload({ tasks: many })))?.issues).toHaveLength(20);
  });

  it('avisa (sem rejeitar) sobre nome de trilha duplicado e títulos repetidos', () => {
    const { warnings } = validate(
      payload({ tasks: [task({ title: 'Igual' }), task({ title: 'igual' })] }),
      { existingTracks: [{ name: '  trilha x ' }] },
    );
    expect(warnings.map((w) => w.code).sort()).toEqual(['DUPLICATE_TASK_TITLE', 'DUPLICATE_TRACK_NAME']);
  });
});
