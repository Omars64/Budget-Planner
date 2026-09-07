const {chromium} = require(process.env.FLOWBUDGET_PLAYWRIGHT || 'playwright')
const assert = require('node:assert/strict')
;(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true})
  try {
    for(const width of [1440,390]) {
      const page = await browser.newPage({viewport:{width,height:900}})
      const errors=[];page.on('pageerror',e=>errors.push(e.message))
      await page.route('**/api/**',route=> {
        const path=new URL(route.request().url()).pathname
        const user={id:1,email:'test@example.com',username:'Test User',role:'user'}
        const values={'/api/auth/login':{user,token:'local-ui-test'},'/api/settings':{display_name:'FlowBudget',currency:'KWD'},'/api/account/appearance':{},'/api/dashboard':{},'/api/passkeys':{enabled:false}}
        return route.fulfill({json:values[path] ?? []})
      })
      await page.goto('http://127.0.0.1:5183/#/settings')
      await page.getByRole('button',{name:'Biometric / passkey',exact:true}).click()
      await page.getByRole('button',{name:'Sign in with passkey',exact:true}).waitFor()
      assert.equal(await page.getByLabel('Password',{exact:true}).count(),0)
      await page.getByRole('button',{name:'Password',exact:true}).click()
      await page.getByLabel('Email',{exact:true}).fill('test@example.com')
      await page.getByLabel('Password',{exact:true}).fill('TestPassword123!')
      await page.getByRole('button',{name:'Sign in',exact:true}).click()
      await page.getByText('Confirm password to register a passkey',{exact:true}).waitFor().catch(async e => { console.log(await page.locator('body').innerText()); console.log(errors); throw e })
      assert.equal(await page.getByText('Mobile number (with country code)',{exact:true}).count(),0)
      const header=await page.locator('.topbar').boundingBox()
      assert(header.x>=0 && header.x+header.width <=width+1)
      await page.screenshot({path:`.verification/signin-settings-${width}.png`})
      assert.deepEqual(errors,[])
      await page.close()
    }
    console.log('PASS: password/passkey choice, Settings registration, header bounds at 390/1440px')
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
