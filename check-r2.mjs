import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('apps/api/.dev.vars','utf8').split('\n').filter(l=>l && !l.startsWith('#') && l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)];}));
const s3 = new S3Client({
  region: 'auto',
  endpoint: env.R2_S3_ENDPOINT,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});
const r = await s3.send(new ListObjectsV2Command({ Bucket: 'clickfy-uploads', Prefix: 'user-uploads/', MaxKeys: 20 }));
console.log('Cloud bucket clickfy-uploads contents under user-uploads/:');
console.log((r.Contents || []).map(o => ({ key: o.Key, size: o.Size, mod: o.LastModified })));
