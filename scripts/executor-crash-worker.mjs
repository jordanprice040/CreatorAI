// Trusted acceptance helper: only the supervisor runs on the host; product code stays in WSL.
import { readFile } from 'node:fs/promises';
import {
  ProductSupervisor,
  ExecutionSupervisor,
  bindingSchema,
  checked,
} from '../packages/executor/dist/index.js';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const supervisor = new ExecutionSupervisor(new ProductSupervisor(config.root));
const result = await supervisor.run(
  config.product_id,
  config.task_id,
  config.commit,
  checked(bindingSchema, config.binding),
  (id) => process.stdout.write(JSON.stringify({ execution_id: id }) + '\n'),
);
process.stdout.write(JSON.stringify(result) + '\n');
