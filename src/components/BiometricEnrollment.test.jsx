import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import BiometricEnrollment from './BiometricEnrollment'
const enabled=vi.hoisted(()=>({value:true}))
vi.mock('../lib/biometric',()=>({biometricSupported:()=>enabled.value,passwordOnlyEnabled:()=>false,setPasswordOnly:vi.fn()}))
vi.mock('./GoogleSignIn',()=>({default:({onComplete})=><button onClick={()=>onComplete()}>Confirm with Google</button>}))
beforeEach(()=>{localStorage.clear();enabled.value=true})
afterEach(cleanup)
const base={enabled:false,busy:false,passwordOnly:false,onPasswordOnly:vi.fn(),password:'',onPassword:vi.fn(),onDisable:vi.fn()}
test.each([false,true])('linked Google account can enroll with Google even when has_password=%s',async has_password=>{
 const onEnable=vi.fn()
 render(<BiometricEnrollment {...base} user={{google_linked:true,has_password}} onEnable={onEnable}/>)
 expect(screen.queryByText('Confirm password to register a passkey')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Confirm with Google'}))
 await waitFor(()=>expect(onEnable).toHaveBeenCalledWith('google'))
})
test('password accounts explain why registration is unavailable and linked users can choose password fallback',()=>{
 render(<BiometricEnrollment {...base} user={{google_linked:true,has_password:true}} onEnable={vi.fn()}/>)
 fireEvent.click(screen.getByRole('button',{name:'Budgetly password',exact:true}))
 expect(screen.getByText('Enter your Budgetly password above to enable registration.')).toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Enable biometric sign-in'})).toBeDisabled()
})
