/** Opt-in integration: disposable Docker fixture, no existing BeeBot containers touched. */
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
if(process.env.BEEBOT_MODEL_DOCKER_TEST!=="1")throw new Error("Explicit disposable Docker verification opt-in required.");
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,"..");
const directory=await mkdtemp(path.join(tmpdir(),"bb-model-mount-")),container="beebot-model-test-"+randomUUID();
const image=process.env.BEEBOT_TEST_NODE_IMAGE;
if(!image||!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error("Use the locally resolved test image ID.");
try{
 const module=path.join(directory,"snapshot.cjs");await build({entryPoints:[path.join(root,"source/shared/node/local-inference-snapshot.ts")],outfile:module,bundle:true,platform:"node",format:"cjs"});
 const {publishLocalInferenceSnapshot}=createRequire(import.meta.url)(module),settings=path.join(directory,"settings.json");
 const account={id:"a",label:"A",provider:"custom",baseUrl:"https://example.test/v1",modelId:"model-a",secretKey:"VENDOR_a_KEY"};
 await writeFile(settings,JSON.stringify({version:1,inferenceProvider:"custom",inferenceVendors:[account],defaultInferenceVendorId:"a"}));
 await writeFile(path.join(directory,"box-secrets.json"),JSON.stringify({secrets:{VENDOR_a_KEY:"fixture-key"}}));
 const snapshot=publishLocalInferenceSnapshot(settings),file=path.join(snapshot,"current.json");
 await exec("docker",["run","-d","--name",container,"--network","none","--mount",`type=bind,src=${snapshot},dst=/models,readonly`,"--mount",`type=bind,src=${file},dst=/old-single-file,readonly`,image,"node","-e","setInterval(()=>{},1000)"]);
 account.modelId="model-b";await writeFile(settings,JSON.stringify({version:1,inferenceProvider:"custom",inferenceVendors:[account],defaultInferenceVendorId:"a"}));publishLocalInferenceSnapshot(settings);
 const {stdout}=await exec("docker",["exec",container,"node","-e",`const f=require('fs');console.log(JSON.stringify({directory:JSON.parse(f.readFileSync('/models/current.json')).vendors[0].modelId,single:JSON.parse(f.readFileSync('/old-single-file')).vendors[0].modelId}));try{f.writeFileSync('/models/current.json','bad');process.exit(3)}catch(e){if(!['EROFS','EACCES'].includes(e.code))throw e;}`]);
 const value=JSON.parse(stdout.trim());if(value.directory!=="model-b"||value.single!=="model-a")throw new Error("Bind-mount replacement expectations not met.");
 await writeFile(process.env.BEEBOT_MODEL_DOCKER_REPORT||path.join(directory,"report.json"),JSON.stringify({passed:true,directoryReload:true,oldSingleFileStale:true,readOnlyEnforced:true,image},null,2));
 console.log("PASS real Docker: directory snapshot updates, old single-file mount remains stale, write denied");
}finally{await exec("docker",["rm","--force",container]).catch(()=>{});await rm(directory,{recursive:true,force:true});}
