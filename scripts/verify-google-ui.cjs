const {chromium,request}=require(process.env.FLOWBUDGET_PLAYWRIGHT || 'playwright')
const assert=require('node:assert/strict')
const fs=require('node:fs')
async function main(){
  const base=process.env.FLOWBUDGET_PREVIEW_URL || 'http://127.0.0.1:5173'
  assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local preview only')
  const client=await request.newContext({baseURL:base})
  const login=await client.post('/api/auth/login',{data:{email:'omarsolanki46@gmail.com',password:'PreviewOnly-2026!'}})
  assert(login.ok(),await login.text());const account=await login.json()
  const headers={Authorization:`Bearer ${account.token}`}
  await client.put('/api/tutorial',{headers,data:{status:'skipped'}})
  await client.post('/api/feedback/rating',{headers,data:{stars:5,comment:'Isolated Google UI check'}})
  const browser=await chromium.launch({channel:'msedge',headless:true})
  fs.mkdirSync('.verification',{recursive:true})
  const errors=[]
  try{for(const width of [320,390,1440])for(const theme of ['light','dark']){
    const native=width<820
    const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce',acceptDownloads:true})
    let connected=false,backups=[]
    await context.addInitScript(({native,theme})=>{
      localStorage.setItem('flowbudget_device_appearance',JSON.stringify({theme}))
      if(native){window.CapacitorCustomPlatform={name:'android'};window.Capacitor={PluginHeaders:[{name:'OAuthBrowser',methods:[{name:'open',rtype:'promise'}]},{name:'BudgetlyReminders',methods:[{name:'configure',rtype:'promise'}]},{name:'LocalNotifications',methods:[{name:'cancel',rtype:'promise'}]},{name:'BankSms',methods:[{name:'pending',rtype:'promise'}]}],nativePromise:async plugin=>{if(plugin==='OAuthBrowser')window.__googleExternal=true;return plugin==='BankSms'?{messages:[]}:undefined}}}
    },{native,theme})
    await context.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Mock Google provider</title><p>Provider stub for local verification</p>'}))
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),path=url.pathname
      const reply=data=>route.fulfill({json:data})
      if(path==='/api/auth/google/config')return reply({enabled:true})
      if(path==='/api/auth/google/start')return reply({authorization_url:'https://accounts.google.com/o/oauth2/v2/auth',poll_secret:'x'.repeat(43)})
      if(path==='/api/auth/google/poll')return reply({status:'name_required'})
      if(path==='/api/auth/google/complete-name'){
        const body=route.request().postDataJSON();assert.equal(body.preferred_name,'Preferred name')
        return reply({...account,status:'complete',user:{...account.user,username:body.preferred_name,signup_provider:'google',google_linked:true}})
      }
      if(path==='/api/auth/google/cancel')return reply({status:'cancelled'})
      if(path==='/api/admin/users')return reply([{...account.user,signup_provider:'google'}])
      if(path==='/api/google-drive/status')return reply({configured:true,connected})
      if(path==='/api/google-drive/start')return reply({authorization_url:'https://accounts.google.com/o/oauth2/v2/auth',flow_id:'x'.repeat(64),poll_secret:'y'.repeat(43)})
      if(path==='/api/google-drive/poll'){connected=true;return reply({status:'connected',connected})}
      if(path==='/api/google-drive/files')return reply({files:backups,next_page_token:null})
      if(path==='/api/google-drive/backup'){const file={id:'localfile',name:'budgetly-local.json',createdTime:'2026-10-05T08:00:00Z'};backups=[file];return reply(file)}
      if(path==='/api/google-drive/disconnect'){connected=false;return reply({connected:false})}
      if(path.startsWith('/api/google-drive/files/'))return route.fulfill({contentType:'application/json',body:'{"version":1,"wallets":[]}'})
      if(url.origin!==base){const response=await route.fetch({url:base+path+url.search});return route.fulfill({response})}
      return route.continue()
    })
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(base)
    await page.getByRole('button',{name:'Continue with Google',exact:true}).waitFor()
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.setProperty('--text',theme==='dark'?'#e4e8e7':'#172c38')},theme)
    assert(await page.evaluate(()=>document.body.innerText.length>50))
    assert.equal(await page.locator('vite-error-overlay').count(),0)
    await page.screenshot({path:`.verification/google-login-${width}-${theme}.png`,fullPage:true})
    await page.getByRole('button',{name:'Continue with Google',exact:true}).click()
    await page.getByLabel('Your name in Budgetly').fill('Preferred name')
    if(native)assert(await page.evaluate(()=>window.__googleExternal),'Android uses native external browser')
    await page.screenshot({path:`.verification/google-name-${width}-${theme}.png`,fullPage:true})
    await page.getByRole('button',{name:'Create Google account'}).click()
    await page.getByText('Personal balance now',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Add transaction',exact:true}).count(),0)
    await page.goto(base+'/#/settings')
    await page.locator('summary').filter({hasText:'Backup & restore'}).click()
    await page.locator('summary').filter({hasText:'Google Drive (optional)'}).click()
    await page.getByRole('button',{name:'Connect Google Drive'}).click()
    await page.getByRole('button',{name:'Back up now'}).click()
    await page.getByRole('button',{name:'Download budgetly-local.json'}).waitFor()
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No overflow ${width} ${theme}`)
    await page.screenshot({path:`.verification/google-drive-${width}-${theme}.png`,fullPage:true})
    await page.getByRole('button',{name:'Disconnect',exact:true}).click()
    await page.getByRole('button',{name:'Confirm',exact:true}).click()
    await page.getByRole('button',{name:'Connect Google Drive'}).waitFor()
    await page.goto(base+'/#/admin')
    await page.locator('summary').filter({hasText:'User management'}).click()
    await page.locator('.user-email .google-mark').waitFor()
    await page.screenshot({path:`.verification/google-admin-${width}-${theme}.png`,fullPage:true})
    await context.close()
  }}finally{await browser.close();await client.dispose()}
  assert.deepEqual(errors,[])
  console.log('Mocked Google UI passed: preferred-name signup, Android external browser bridge, Drive connect/upload/list/disconnect, admin indicator, light/dark 320/390/1440px. Live provider consent requires Console setup.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
