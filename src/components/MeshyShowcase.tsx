import { useEffect, useRef } from 'react';

export function MeshyShowcase() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    import('../lib/meshy-showcase').then(({ mountMeshyShowcase }) => {
      if (!disposed && rootRef.current) cleanup = mountMeshyShowcase(rootRef.current);
    }).catch(() => {
      const status = rootRef.current?.querySelector('[role="status"]');
      if (status) status.textContent = '3D表示の代わりにモデルの写真を表示しています。';
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div ref={rootRef} className="meshy-world" data-ready="false">
      <div className="meshy-world__backdrop" aria-hidden="true">
        <span>MAKE</span><span>PLAY</span><span>NOTE</span>
      </div>

      <div className="meshy-world__stage" role="img" aria-label="ポータルから飛び出す制作机、ロボット、ロケット、羽根つき鉛筆などの3Dワールド">
        <div className="meshy-world__loading" aria-hidden="true"><i></i><span>BUILDING A SMALL UNIVERSE</span></div>
      </div>

      <div className="meshy-world__fallback" aria-hidden="true">
        <img className="meshy-world__fallback-portal" src="/models/meshy/portal/thumbnail.png" alt="" />
        <img className="meshy-world__fallback-desk" src="/models/meshy/desk/thumbnail.png" alt="" />
        <img className="meshy-world__fallback-robot" src="/models/meshy/robot/thumbnail.png" alt="" />
        <img className="meshy-world__fallback-rocket" src="/models/meshy/rocket/thumbnail.png" alt="" />
        <img className="meshy-world__fallback-cloud" src="/models/meshy/cloud/thumbnail.png" alt="" />
        <img className="meshy-world__fallback-pencil" src="/models/meshy/winged-pencil/thumbnail.png" alt="" />
      </div>

      <span className="sr-only" role="status" aria-live="polite">立体モデルを読み込んでいます。</span>
    </div>
  );
}
