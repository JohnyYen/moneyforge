import { loadDedupSecret } from './inbox-flow';
import { createInboxUseCases } from './inbox-use-cases';
import { createIngestMessage } from './ingest-message';
import type { RuleDeps } from './ports';
import { createRuleUseCases } from './rule-use-cases';

export function createRulesService(deps: RuleDeps) {
  return {
    ingestMessage: createIngestMessage(deps),
    loadDedupSecret: () => loadDedupSecret(deps),
    ...createRuleUseCases(deps),
    ...createInboxUseCases(deps),
  };
}

export type RulesService = ReturnType<typeof createRulesService>;
