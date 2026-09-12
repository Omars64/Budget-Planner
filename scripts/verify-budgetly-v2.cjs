const { chromium, request } = require(process.env.FLOWBUDGET_PLAYWRIGHT || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

async function main() {
  const base = process.env.FLOWBUDGET_TEST_URL || 'http://127.0.0.1:5192'
  if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw Error('Use an isolated local database only')
  const password = process.env.FLOWBUDGET_TEST_PASSWORD
  if (!password) throw Error('Set FLOWBUDGET_TEST_PASSWORD for the local test account')
  const client = await request.newContext({baseURL:base})
  async function call(path, token, method='GET', data) {
    const response=await client.fetch(path,{method,data,headers:token?{Authorization:'Bearer '+token}:{}})
    assert(response.ok(), method+' '+path+': '+await response.text())
    return response.status()===204 ? null : response.json()
  }
  const admin=await call('/api/auth/login',null,'POST',{email:'omarsolanki46@gmail.com',password})
  const stamp=Date.now()
  const people=[]
  const errors=[]
  let currentPage
  const browser=await chromium.launch({headless:true,channel:'msedge'})
  try {
    for (const name of ['owner','member']) people.push(await call('/api/admin/users',admin.token,'POST',{username:'UI '+name,email:`v2-${name}-${stamp}@example.com`,password}))
    const owner=await call('/api/auth/login',null,'POST',{email:people[0].email,password})
    const wallet=await call('/api/wallets',owner.token,'POST',{name:'Home',initial_balance:150,type:'cash'})
    await call('/api/shared/wallets/'+wallet.id+'/shares',owner.token,'POST',{email:people[1].email,permission:'edit'})
    const cats=await call('/api/categories',owner.token)
    const category=cats.find(c=>c.name==='Food & Dining')
    for (const [description,date,amount] of [['Breakfast','2026-09-12T08:05:00',3],['Grocery shopping','2026-09-11T17:00:00',8.750],['August groceries','2026-08-10T08:00:00',4]]) {
      await call('/api/transactions',owner.token,'POST',{type:'expense',amount,description,wallet_id:wallet.id,category_id:category?.id,date})
    }
    const note=await call('/api/notes',owner.token,'POST',{title:'Recovery test',content:'Temporary local note'})
    await call('/api/notes/'+note.id,owner.token,'DELETE')
    fs.mkdirSync('.verification',{recursive:true})
    for (const [width,native] of [[1440,false],[390,false],[320,false],[390,true]]) {
      const context=await browser.newContext({viewport:{width,height:900}})
      await context.addInitScript(({token,native})=>{
        sessionStorage.setItem('flowbudget_token',token)
        if (native) {
          window.CapacitorCustomPlatform={name:'android'}
          window.Capacitor={PluginHeaders:[{name:'LocalNotifications',methods:[{name:'cancel',rtype:'promise'}]},{name:'BankSms',methods:[{name:'pending',rtype:'promise'}]}],nativePromise:async plugin=>plugin==='BankSms'?{messages:[]}:undefined}
        }
      },{token:owner.token,native})
      if (native) await context.route('https://budget-planner-ecru-seven.vercel.app/**',async route=>{
        const url=new URL(route.request().url())
        const response=await route.fetch({url:base+url.pathname+url.search})
        await route.fulfill({response})
      })
      const page=await context.newPage()
      currentPage=page
      page.setDefaultTimeout(12000)
      page.on('pageerror',e=>errors.push(e.message))
      const label=native?'android':String(width)
      for (const route of ['transactions','shared-transactions']) {
        await page.goto(base+'/#/'+route)
        await page.locator('.ledger-entry').first().waitFor()
        assert.equal(await page.locator('.transaction-fab').count(),native?1:0)
        assert.equal(await page.locator('.topbar .add-button').count(),native?0:1)
        await page.getByRole('button',{name:'Filter transactions'}).click()
        const dialog=page.getByRole('dialog',{name:'Filters'})
        await dialog.getByLabel('Wallet',{exact:true}).selectOption(String(wallet.id))
        await dialog.locator('input[type="month"]').fill('2026-09')
        await dialog.getByRole('button',{name:'Apply filters'}).click()
        await dialog.waitFor({state:'hidden'})
        await page.getByRole('button',{name:'Remove month filter'}).waitFor()
        await page.waitForFunction(()=>[...document.querySelectorAll('.ledger-entry')].every(el=>!el.textContent.includes('August')))
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow '+route+' '+label)
        assert.equal(await page.locator('.wallet-badges').count(),0)
        const accent=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
        assert.equal(accent,'#0a4173')
        await page.screenshot({path:'.verification/v2-'+route+'-'+label+'.png',fullPage:true})
        await page.locator('.ledger-entry').first().click()
        await page.getByRole('dialog').waitFor()
        await page.getByRole('button',{name:'Close dialog'}).click()
        await page.getByRole('dialog').waitFor({state:'hidden'})
        await page.getByRole('button',{name:'Add transaction',exact:true}).click()
        const form=page.getByRole('dialog')
        await form.waitFor()
        assert((await form.innerText()).includes(route==='shared-transactions'?'Add shared transaction':'Add transaction'))
        if(route==='transactions') {
          await form.getByLabel('Amount (KWD)').fill('1')
          await form.getByText('More options',{exact:true}).click()
          await form.getByLabel('Repeat',{exact:true}).selectOption('weekly')
          await form.getByRole('button',{name:'Add transaction',exact:true}).click()
          await form.getByRole('alert').filter({hasText:'repeat-until'}).waitFor()
          await form.getByLabel('Repeat until').fill('2026-12-31')
          await page.screenshot({path:'.verification/v2-form-'+label+'.png',fullPage:true})
        }
        await form.getByRole('button',{name:'Close dialog'}).click()
        await form.waitFor({state:'hidden'})
      }
      await page.goto(base+'/#/settings')
      await page.locator('.settings-section').first().waitFor()
      assert.equal(await page.locator('.transaction-fab,.topbar .add-button').count(),0)
      assert.equal(await page.locator('.settings-section[open]').count(),0)
      await page.screenshot({path:'.verification/v2-settings-'+label+'.png',fullPage:true})
      const trash=page.locator('.settings-section').filter({has:page.locator('summary').filter({hasText:/^Trash$/})})
      await trash.locator('summary').first().click()
      await trash.getByRole('button',{name:/Delete backup/}).first().waitFor()
      if(width===1440) {
        await trash.getByRole('button',{name:/Delete backup/}).first().click()
        await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click()
        await page.getByText('Recovery backup deleted',{exact:true}).waitFor()
        const n=await call('/api/notes',owner.token,'POST',{title:'Second recovery test'})
        await call('/api/notes/'+n.id,owner.token,'DELETE')
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Settings overflow '+label)
      await context.close()
      console.log('PASS '+label+': ledger, filters, forms, settings, accent, overflow')
    }
    assert.deepEqual(errors,[])
  } catch(error) {
    if(currentPage && !currentPage.isClosed()) {
      await currentPage.screenshot({path:'.verification/v2-failure.png',fullPage:true})
      console.error(await currentPage.locator('.modal').evaluateAll(nodes=>nodes.map(n=>({role:n.getAttribute('role'),title:n.querySelector('h3')?.textContent,labels:[...n.querySelectorAll('label')].map(l=>l.textContent)}))))
    }
    throw error
  } finally {
    await browser.close()
    for(const person of people) await call('/api/admin/users/'+person.id,admin.token,'DELETE')
    await client.dispose()
  }
}
main().catch(e=>{console.error(e);process.exitCode=1})
