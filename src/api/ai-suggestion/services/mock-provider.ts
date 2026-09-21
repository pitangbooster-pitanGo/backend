import type { AiProvider, ProviderRequest } from './ai-types';

/**
 * Provedor de desenvolvimento: determinístico, sem rede e sem custo. Usado
 * quando não há credenciais de IA (padrão) e por todos os testes.
 *
 * Marcadores no objetivo simulam falhas para exercitar o tratamento de erro
 * ponta a ponta (só existem neste provedor):
 *   [[mock:error]] [[mock:empty]] [[mock:invalid]] [[mock:invalid-deps]] [[mock:timeout]]
 */
const MARKER = /\[\[mock:[a-z-]+\]\]/g;

const buildStructure = (request: ProviderRequest) => {
  const topic = request.goal.replace(MARKER, '').replace(/\s+/g, ' ').trim().slice(0, 70);

  const tasks = [
    {
      title: `Entender o objetivo: ${topic}`,
      description: 'Leia o contexto e alinhe expectativas com a liderança.',
      action_type: 'reading',
      requires_evidence: false,
      requires_manual_approval: false,
      depends_on: [] as number[],
    },
    {
      title: 'Estudar o material de apoio',
      description: 'Consulte a documentação e os materiais indicados.',
      action_type: 'reading',
      requires_evidence: false,
      requires_manual_approval: false,
      depends_on: [1],
    },
    {
      title: 'Praticar com um exercício guiado',
      description: 'Aplique o que aprendeu em um exercício prático.',
      action_type: 'form',
      requires_evidence: false,
      requires_manual_approval: false,
      depends_on: [2],
    },
    {
      title: 'Registrar a evidência da prática',
      description: 'Envie um link ou arquivo que comprove a prática realizada.',
      action_type: 'upload',
      requires_evidence: true,
      requires_manual_approval: true,
      depends_on: [3],
    },
    {
      title: 'Revisar o resultado com a liderança',
      description: 'Apresente o resultado e registre os próximos passos.',
      action_type: 'reading',
      requires_evidence: false,
      requires_manual_approval: true,
      depends_on: [4],
    },
  ].slice(0, request.maxTasks);

  return {
    track: {
      name: `Trilha: ${topic}`.slice(0, 120),
      description: `Trilha sugerida (modo simulado) para o objetivo: ${topic}`,
      track_type: request.trackType,
    },
    tasks,
  };
};

export const mockProvider: AiProvider = {
  name: 'mock',
  async generate(request, { signal }) {
    const goal = request.goal;

    if (goal.includes('[[mock:timeout]]')) {
      // Fica pendurado até o AbortSignal disparar (timeout do AIService).
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (goal.includes('[[mock:error]]')) {
      throw new Error('Falha simulada do provedor mock');
    }
    if (goal.includes('[[mock:empty]]')) {
      return { text: '', model: 'mock' };
    }
    if (goal.includes('[[mock:invalid]]')) {
      return { text: 'Desculpe, não consegui gerar a trilha em JSON.', model: 'mock' };
    }
    if (goal.includes('[[mock:invalid-deps]]')) {
      const structure = buildStructure(request);
      structure.tasks[0].depends_on = [3]; // dependência posterior: violaria a regra do backend
      return { text: JSON.stringify(structure), model: 'mock' };
    }

    return { text: JSON.stringify(buildStructure(request)), model: 'mock' };
  },
};
