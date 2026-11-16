import { RuleBasedTutorEngine } from './RuleBasedTutorEngine';
import {
  ITutorEngine,
  PerformanceSummary,
  TrainingPlan,
  TutorEngineType,
} from './TutorEngineInterface';

/**
 * Future Strategy Slot for LLM-backed Piano Pedagogy Coaching.
 * Swap `engineType = 'LLM'` in `getTrainingPlan` once backend LLM endpoint is enabled;
 * the UI consumes the identical `TrainingPlan` JSON contract without changes.
 */
export class LLMTutorEngine implements ITutorEngine {
  public readonly engineType = 'LLM' as const;
  private readonly fallbackEngine = new RuleBasedTutorEngine();

  public async generatePlan(performanceData: PerformanceSummary): Promise<TrainingPlan> {
    // Attempt server-side LLM endpoint if configured; gracefully fall back to RuleBasedTutorEngine
    try {
      const response = await fetch('/api/tutor/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(performanceData),
      });

      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('application/json')) {
        const plan = (await response.json()) as TrainingPlan;
        if (plan && Array.isArray(plan.trainingPlaylist)) {
          return { ...plan, engineType: 'LLM' };
        }
      }
    } catch {
      // Fall back silently to local deterministic pedagogy engine
    }

    const fallbackPlan = await this.fallbackEngine.generatePlan(performanceData);
    return {
      ...fallbackPlan,
      engineType: 'RULE',
    };
  }
}

const ruleEngineSingleton = new RuleBasedTutorEngine();
const llmEngineSingleton = new LLMTutorEngine();

/**
 * Strategy Factory: returns the requested ITutorEngine implementation.
 */
export function createTutorEngine(engineType: TutorEngineType = 'RULE'): ITutorEngine {
  switch (engineType) {
    case 'LLM':
      return llmEngineSingleton;
    case 'RULE':
    default:
      return ruleEngineSingleton;
  }
}

/**
 * Clean UI-facing Wrapper Function:
 * React components call `getTrainingPlan(summary, engineType)` without coupling
 * to any concrete rule-set or LLM implementation.
 */
export async function getTrainingPlan(
  performanceData: PerformanceSummary,
  engineType: TutorEngineType = 'RULE'
): Promise<TrainingPlan> {
  const engine = createTutorEngine(engineType);
  return engine.generatePlan(performanceData);
}
