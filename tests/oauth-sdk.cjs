'use strict';

// Optional real-CDN regression: node tests/oauth-sdk.cjs
// No packages, real credentials, Supabase requests or Google navigation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const source = fs.readFileSync(path.join(__dirname,'../auth.js'),'utf8');
  const sdkURL = source.match(/const SDK_URL = '([^']+)'/)[1];
  assert.match(sdkURL, /@supabase\/supabase-js@2\.\d+\.\d+\/dist\/umd\/supabase\.js$/);
  const response = await fetch(sdkURL,{signal:AbortSignal.timeout(20000)});
  assert.equal(response.ok,true,'Pinned SDK must be available for this optional check');
  // Use the exact production CDN bundle; the trailing expression reads its export.
  const sdk = vm.runInThisContext((await response.text())+'\n;supabase;');
  const project = 'https://qacmdslklqekinuqvqrp.supabase.co';
  const client = sdk.createClient(project,'sb_publishable_regression_fixture',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'pkce'},
    global:{fetch:() => {throw new Error('This URL-only test must not contact Supabase');}}
  });
  assert.equal(client.supabaseUrl,project);
  assert.equal(client.auth.url,project+'/auth/v1');
  assert.equal(client.rest.url,project+'/rest/v1');
  for (const redirectTo of ['http://localhost:8080/','https://chrislark1.github.io/bella-diary/']) {
    const {data,error} = await client.auth.signInWithOAuth({
      provider:'google',options:{redirectTo,skipBrowserRedirect:true}
    });
    assert.equal(error,null);
    const authorize = new URL(data.url);
    assert.equal(authorize.origin,project);
    assert.equal(authorize.pathname,'/auth/v1/authorize');
    assert.equal(authorize.searchParams.get('provider'),'google');
    assert.equal(authorize.searchParams.get('redirect_to'),redirectTo);
  }
  console.log('PASS: pinned real SDK keeps Auth/REST separate and preserves both OAuth redirects');
})().catch(() => {
  // Keep raw SDK errors and any credentials out of test logs.
  console.error('FAIL: real SDK OAuth URL regression. Check CDN availability and assertions.');
  process.exitCode = 1;
});
