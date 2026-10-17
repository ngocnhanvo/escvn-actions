#!/usr/bin/env node
// Persistent node_modules and per-project Astro workspace for trusted private ESC Build Hub.
// NEVER pass .env, GitHub tokens or FTP credentials to this script.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const [mode, project, sourceDir, baseDir, pnpmVersion='9'] = process.argv.slice(2);
const PROJECTS = new Set(['esc','anhsang']);
if (!['prepare','mark-installed'].includes(mode) || !PROJECTS.has(project) || !sourceDir || !baseDir) {
  throw new Error('Usage: node persistent-deps.mjs prepare|mark-installed esc|anhsang CHECKOUT_ROOT HUB_BASE PNPM_VERSION');
}
const base = path.resolve(baseDir), src=path.resolve(sourceDir);
if (base === path.parse(base).root || src === path.parse(src).root || base === src) {
  throw new Error('Unsafe root directory.');
}
const dst=path.join(base,'projects',project,'source');
const store=path.join(base,'stores',project);
const preserved=new Set(['node_modules','.cache','dist','.hub-install-stamp.json']);
const excluded=new Set(['.git','.env','.env.local','.env.production','node_modules','.cache','dist','.hub-install-stamp.json']);
if (!fs.existsSync(path.join(src,'pnpm-lock.yaml')) || !fs.existsSync(path.join(src,'package.json'))) {
  throw new Error('Checked-out source has no pnpm-lock.yaml or package.json');
}
const fileHash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fingerprint=crypto.createHash('sha256').update([
  fileHash(path.join(src,'pnpm-lock.yaml')),
  fileHash(path.join(src,'package.json')),
  process.version, pnpmVersion, process.platform, process.arch
].join('|')).digest('hex');
const stampFile=path.join(dst,'.hub-install-stamp.json');
function exists(file){return fs.existsSync(file)}
function readStamp(){
  try{return JSON.parse(fs.readFileSync(stampFile,'utf8'))}catch{return null}
}
if (mode==='prepare') {
  fs.mkdirSync(dst,{recursive:true});
  fs.mkdirSync(store,{recursive:true});
  // Remove stale source files, but NEVER delete persistent deps/cache or the install marker.
  for(const name of fs.readdirSync(dst)){
    if(preserved.has(name))continue;
    fs.rmSync(path.join(dst,name),{recursive:true,force:true,maxRetries:3,retryDelay:150});
  }
  for(const name of fs.readdirSync(src)){
    if(excluded.has(name))continue;
    fs.cpSync(path.join(src,name),path.join(dst,name),{recursive:true,force:true,errorOnExist:false});
  }
  // No .env is ever reused from a previous job.
  for(const file of ['.env','.env.local','.env.production']){
    fs.rmSync(path.join(dst,file),{force:true});
  }
  fs.rmSync(path.join(dst,'dist'),{recursive:true,force:true});
  const stamp=readStamp();
  const bin=path.join(dst,'node_modules','.bin',process.platform==='win32'?'astro.cmd':'astro');
  const modules=path.join(dst,'node_modules','.modules.yaml');
  const needsInstall=stamp?.fingerprint!==fingerprint||!exists(bin)||!exists(modules);
  console.log(JSON.stringify({project,workspace:dst,store,needsInstall,fingerprint,cachePresent:exists(path.join(dst,'.cache'))}));
} else {
  const modules=path.join(dst,'node_modules','.modules.yaml');
  if(!exists(modules))throw new Error('Cannot mark dependencies installed before node_modules validation.');
  // The marker is written only AFTER pnpm install exits successfully.
  const tmp=stampFile+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({fingerprint,node:process.version,pnpm:pnpmVersion,platform:process.platform,arch:process.arch,updated_at:new Date().toISOString()},null,2),'utf8');
  fs.renameSync(tmp,stampFile);
  console.log('Dependency installation validated; pinned fingerprint recorded.');
}
