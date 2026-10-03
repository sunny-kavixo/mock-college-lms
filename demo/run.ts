import { runWorker } from "../worker/index";
import { safeError } from "../worker/artifacts";

runWorker()
  .then((result) => {
    console.log("✅ Browser demo flow completed");
    console.log(result);
  })
  .catch((error: unknown) => {
    console.error(
      `❌ Browser demo flow failed: ${safeError(error)}`
    );
    process.exitCode = 1;
  });
