// Documented provider pricing bundled with the studio, so a real workspace can add it from
// Monitor › Budgets instead of `pnpm cli pricing-add`. Each file is the reviewed, dated copy
// in config/pricing; the server parses it again. Batch pricing is left out: context batches
// create their own batch snapshot when they need one.
import astra from '../../../config/pricing/openai-gpt-6-astra.json';

export const DOCUMENTED_PRICING = [
  {
    file: 'openai-gpt-6-astra.json',
    label: 'GPT-6 Astra (OpenAI, standard tier)',
    body: astra,
  },
];
