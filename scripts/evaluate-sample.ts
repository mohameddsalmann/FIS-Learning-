import { evaluatePreparedRetrieval } from "../src/lib/evaluation";

const result = evaluatePreparedRetrieval();
console.log(JSON.stringify(result,null,2));
if (result.recallAt2 < 1 || result.abstentions !== result.negative) process.exitCode=1;
