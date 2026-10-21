/** Best-effort foreground screen lock only. Never implies background microphone access. */
export function keepConversationAwake() {
  let stopped=false, pending=false, lock:WakeLockSentinel|undefined;
  const acquire=async()=>{
    if(stopped||pending||lock&&!lock.released||document.visibilityState!=='visible'||!navigator.wakeLock)return;
    pending=true;
    try{const next=await navigator.wakeLock.request('screen');
      if(stopped||document.visibilityState!=='visible')await next.release();else lock=next;
    }catch{/* Browser policy, battery state or unsupported device: conversation remains usable. */}
    finally{pending=false;}
  };
  document.addEventListener('visibilitychange',acquire);void acquire();
  return ()=>{stopped=true;document.removeEventListener('visibilitychange',acquire);void lock?.release().catch(()=>undefined);lock=undefined;};
}
