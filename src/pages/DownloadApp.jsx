import BrandLogo from '../components/BrandLogo'
import BrandFooter from '../components/BrandFooter'
import AndroidReleaseDownload from '../components/AndroidReleaseDownload'

export default function DownloadApp() {
  return <main className="download-page">
    <header className="brand"><BrandLogo/><div><strong>Budgetly</strong><small>For Android</small></div></header>
    <section><h1>Budgetly for Android</h1><AndroidReleaseDownload/><a href="/">Open Budgetly on the web</a></section>
    <BrandFooter/>
  </main>
}
