/** Compare downloaded fixture JPEG hashes with independent calls to the existing Studio renderer. */
if (location.hostname !== "localhost") throw new Error("Local QA only");
const repo = await import("/src/lib/projects/repository.ts");
const project = await repo.loadProject(new URL(location.href).searchParams.get("project"));
if (project.title !== "QA native workflow — September 4") throw new Error("QA project required");
const {shots} = await (await import("/src/lib/projects/studio-adapter.ts")).hydrateProject(project);
const {decodeFile,renderToCanvas} = await import("/src/lib/imaging.ts");
const {hashBlob} = await import("/src/lib/projects/archive.ts");
const expected = {
  "volleyball-portrait-cc0.jpg":"b2c4e518a301170814a8887969fbc04e31ca58c1806457773a777491e730debe",
  "basketball-action-usaf-pd.jpg":"65fe54cda1ae55039365d8fe9e207e8009f550be4770b4612f635fa9e0b122e4",
};
try {
  const results=[];
  for(const shot of shots.filter(shot=>shot.verdict==="keep")){
    const bitmap=await decodeFile(shot.file,2048);
    try{
      const canvas=document.createElement("canvas");
      renderToCanvas(canvas,bitmap,shot.edits,2048,shot.cropFocus);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.92));
      const sha256=await hashBlob(blob);
      results.push({name:shot.name,width:canvas.width,height:canvas.height,sha256,exactDownloadMatch:sha256===expected[shot.name]});
    }finally{bitmap.close();}
  }
  return results;
}finally{for(const shot of shots)if(shot.previewUrl)URL.revokeObjectURL(shot.previewUrl);}
