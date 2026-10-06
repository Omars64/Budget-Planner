export async function receiptImage(file) {
  if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG or WebP photo.')
  if(file.size>15_000_000)throw new Error('Choose a photo smaller than 15 MB.')
  const bitmap=await globalThis.createImageBitmap(file)
  try{
    const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
    const context=canvas.getContext('2d')
    if(!context)throw new Error('Photo processing is unavailable on this device.')
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height)
    context.drawImage(bitmap,0,0,canvas.width,canvas.height)
    const image=canvas.toDataURL('image/jpeg',.8)
    if(image.length>2_000_000)throw new Error('Photo is still too large. Choose a smaller photo.')
    return {name:file.name.slice(0,180)||'Receipt.jpg',image}
  }finally{bitmap.close()}
}
