const {chromium,request}=require(process.env.FLOWBUDGET_PLAYWRIGHT || 'playwright')
const assert=require('node:assert/strict')
const fs=require('node:fs')
async function main() {
  const base=process.env.FLOWBUDGET_PREVIEW_URL || 'http://127.0.0.1:5173'
  assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Use an isolated local preview, never production')
  const client=await request.newContext({baseURL:base})
  const response=await client.post('/api/auth/login',{data:{email:'omarsolanki46@gmail.com',password:'PreviewOnly-2026!'}})
  assert(response.ok(),await response.text())
  const {token}=await response.json(), headers={Authorization:`Bearer ${token}`}
  await client.put('/api/tutorial',{headers,data:{status:'skipped'}})
  await client.post('/api/feedback/rating',{headers,data:{stars:5,comment:'Temporary UX verification account'}})
  const walletResponse=await client.post('/api/wallets',{headers,data:{name:'UX test card',type:'bank',color:'#183d36',card_network:'mastercard',initial_balance:120}})
  assert(walletResponse.ok(),await walletResponse.text())
  const browser=await chromium.launch({channel:'msedge',headless:true})
  fs.mkdirSync('.verification',{recursive:true})
  const errors=[]
  try {
    for(const width of [320,390,1440]) for(const theme of ['light','dark']) {
      const native=width<820
      const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'})
      await context.addInitScript(({token,native})=>{
        sessionStorage.setItem('flowbudget_token',token)
        if(native){window.CapacitorCustomPlatform={name:'android'};window.Capacitor={PluginHeaders:[{name:'BudgetlyReminders',methods:[{name:'configure',rtype:'promise'}]},{name:'LocalNotifications',methods:[{name:'cancel',rtype:'promise'}]},{name:'BankSms',methods:[{name:'pending',rtype:'promise'}]}],nativePromise:async plugin=>plugin==='BankSms'?{messages:[]}:undefined}}
      },{token,native})
      if(native)await context.route('https://budget-planner-ecru-seven.vercel.app/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:base+url.pathname+url.search});await route.fulfill({response})})
      const page=await context.newPage()
      page.on('pageerror',error=>errors.push(error.message))
      await page.goto(base+'/#/')
      await page.getByText('Personal balance now',{exact:true}).waitFor()
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.setProperty('--text',theme==='dark'?'#e4e8e7':'#172c38');document.documentElement.style.fontSize='20px'},theme)
      assert.equal(await page.getByRole('button',{name:'Add transaction',exact:true}).count(),0)
      assert.equal(await page.locator('.overview-disclosure').evaluate(el=>el.open),false)
      for(const path of ['/','/wallets','/transactions','/shared-transactions','/upcoming','/notes','/settings']) {
        await page.goto(base+'/#'+path)
        await page.locator('.page-wrap').waitFor()
        await page.waitForTimeout(500)
        if(path==='/settings') {
          await page.locator('summary').filter({hasText:'Personal preferences'}).click()
          await page.getByLabel('Notes view',{exact:true}).selectOption('list')
          await page.locator('summary').filter({hasText:'Page order'}).click()
          await page.getByRole('button',{name:'Move Notes up',exact:true}).click()
          assert.equal(await page.getByLabel('Notes view',{exact:true}).inputValue(),'list')
        }
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${path} ${width} ${theme}`)
        await page.screenshot({path:`.verification/ux-${path.replaceAll('/','')||'overview'}-${width}-${theme}.png`,fullPage:true})
      }
      await page.goto(base+'/#/notes')
      await page.getByRole('button',{name:'Grid view',exact:true}).waitFor()
      await page.getByRole('button',{name:'New note',exact:true}).click()
      await page.getByRole('button',{name:'Folder and paper settings',exact:true}).click()
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Notes tools fit the narrow screen')
      await page.screenshot({path:`.verification/ux-note-editor-${width}-${theme}.png`,fullPage:true})
      await page.getByRole('button',{name:'Back to notes',exact:true}).click()
      await page.goto(base+'/#/transactions')
      await page.getByRole('button',{name:'Add transaction',exact:true}).first().click()
      await page.getByLabel('Description',{exact:true}).fill('Interrupted UX draft')
      await page.getByRole('button',{name:'Close dialog',exact:true}).click()
      await page.getByRole('dialog').waitFor({state:'hidden'})
      await page.getByRole('button',{name:'Add transaction',exact:true}).first().click()
      assert.equal(await page.getByLabel('Description',{exact:true}).inputValue(),'Interrupted UX draft')
      await page.locator('.modal .form-options summary').filter({hasText:'More options'}).click()
      await page.getByRole('button',{name:'Discard draft',exact:true}).click()
      await page.getByRole('button',{name:'Close dialog',exact:true}).click()
      await context.close()
    }
    assert.deepEqual(errors,[])
    console.log('Workspace UX: 320/390/1440px, light/dark, reduced motion, larger text, no overflow, read-only Overview and recoverable drafts passed.')
  } finally {await browser.close();await client.dispose()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
