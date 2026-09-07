/** Observe one test-only Blob download without preventing the browser download. */
if (location.hostname !== "localhost") throw new Error("Local QA only");
const id = new URL(location.href).searchParams.get("project");
const project = await (await import("/src/lib/projects/repository.ts")).loadProject(id);
if (project.title !== "QA native workflow — September 4") throw new Error("QA project required");
window.__deadlineQA = null;
const handler = event => {
  const anchor = event.target;
  if (!(anchor instanceof HTMLAnchorElement) || !anchor.download || !anchor.href.startsWith("blob:")) return;
  document.removeEventListener("click",handler,true);
  window.__deadlineQA = fetch(anchor.href).then(response=>response.blob()).then(blob=>new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
  }));
};
document.addEventListener("click",handler,true);
return "Watching the next fixture ZIP download";
