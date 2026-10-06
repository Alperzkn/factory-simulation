// Builds dist/: a static, browser-only copy of the viewer and docs (no server, no REST/MQTT/OPC UA).
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const cp = (from, to) => cpSync(path.join(root, from), path.join(out, to), {recursive:true});

rmSync(out, {recursive:true, force:true});
mkdirSync(out);
cp('public', '.');
cp('shared', 'shared');
cp('docs', 'docs');
cp('node_modules/three/build/three.module.js', 'vendor/three/build/three.module.js');
cp('node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js', 'vendor/three/examples/jsm/geometries/RoundedBoxGeometry.js');
cp('node_modules/three/examples/jsm/environments/RoomEnvironment.js', 'vendor/three/examples/jsm/environments/RoomEnvironment.js');
cp('node_modules/marked/lib/marked.esm.js', 'vendor/marked/lib/marked.esm.js');
for (const f of ['barlow', 'barlow-condensed']) for (const w of ['400', '500', '600']) cp(`node_modules/@fontsource/${f}/${w}.css`, `vendor/fontsource/${f}/${w}.css`);
for (const f of ['barlow', 'barlow-condensed']) cp(`node_modules/@fontsource/${f}/files`, `vendor/fontsource/${f}/files`);
// tell the viewer to run the engine in the page instead of looking for a server
const index = path.join(out, 'index.html');
writeFileSync(index, readFileSync(index, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="twin-mode" content="local">'));
console.log('Static site written to dist/');
