import atlas from '../assets/seasonal/stickers.webp'
// CSS crops share one bundled, cached, original sticker atlas.
const crops = [
 [18,52,252,220],[276,58,244,218],[524,95,250,162],[770,98,280,155],[1048,56,258,225],[1320,74,195,195],
 [14,276,278,246],[320,280,199,230],[544,278,229,240],[790,282,244,224],[1056,282,234,232],[1300,275,222,240],
 [30,520,235,232],[293,516,230,234],[539,520,228,230],[785,520,227,231],[1040,517,243,235],[1299,517,223,235],
 [18,752,258,245],[280,748,264,244],[533,752,240,244],[782,746,245,250],[1045,753,243,244],[1307,753,215,239],
]
export function seasonalSpriteStyle(index) {
 const [x,y,width,height]=crops[index] || crops[0]
 return {backgroundImage:`url(${atlas})`,backgroundSize:`${1536/width*100}% ${1024/height*100}%`,backgroundPosition:`${x/(1536-width)*100}% ${y/(1024-height)*100}%`}
}
