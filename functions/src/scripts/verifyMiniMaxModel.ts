import { verifyMiniMaxModel } from '../utils/minimaxModels';

async function main(): Promise<void> {
  const model = await verifyMiniMaxModel(process.env.MINIMAX_API_KEY ?? '');
  console.log(`[minimax] Verified model: ${model.id}`);
}

main().catch((error) => {
  console.error(`[minimax] Verification failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
