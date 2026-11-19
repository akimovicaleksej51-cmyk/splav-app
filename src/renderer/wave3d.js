/* Сплав — 3D-сцена «Моей волны»: жидкая бордовая сфера + холодная пыль */
(function () {
  const NOISE = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }`;

  const VERT = NOISE + `
  uniform float uTime; uniform float uEnergy; uniform float uPulse;
  varying vec3 vNormal; varying vec3 vView; varying float vDisp;
  float field(vec3 p){
    float t=uTime*0.35;
    float n = snoise(p*0.95 + vec3(t, t*0.7, -t*0.5)) * (0.10 + 0.11*uEnergy);
    n += snoise(p*1.9 - vec3(t*1.1)) * (0.025 + 0.035*uEnergy);
    n += uPulse * 0.06 * sin(p.y*5.0 - uTime*5.0);
    return n;
  }
  vec3 displaced(vec3 p){ return p * (1.0 + field(p)); }
  void main(){
    vec3 p = position;
    vec3 n = normalize(normal);
    vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
    vec3 b = normalize(cross(n, t));
    float e = 0.012;
    vec3 dp  = displaced(p);
    vec3 dpt = displaced(normalize(p + t*e) * length(p));
    vec3 dpb = displaced(normalize(p + b*e) * length(p));
    vec3 nn = normalize(cross(dpt - dp, dpb - dp));
    if (dot(nn, n) < 0.0) nn = -nn;
    vDisp = field(p);
    vec4 mv = modelViewMatrix * vec4(dp, 1.0);
    vNormal = normalize(normalMatrix * nn);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

  const FRAG = `
  uniform float uEnergy; uniform float uTime;
  varying vec3 vNormal; varying vec3 vView; varying float vDisp;
  void main(){
    vec3 N = normalize(vNormal), V = normalize(vView);
    vec3 L1 = normalize(vec3(-0.6, 0.8, 0.7));   // холодный ключевой свет
    vec3 L2 = normalize(vec3(0.8, -0.3, 0.4));   // кровавый заполняющий
    float diff = max(dot(N, L1), 0.0);
    float fill = max(dot(N, L2), 0.0);
    vec3 H = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), 90.0);
    float spec2 = pow(max(dot(N, normalize(L2 + V)), 0.0), 30.0);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

    vec3 deep = vec3(0.10, 0.008, 0.02);
    vec3 blood = vec3(0.50, 0.04, 0.09);
    vec3 col = mix(deep, blood, smoothstep(-0.15, 0.25, vDisp) * (0.55 + 0.45*uEnergy));
    col *= 0.35 + 0.9*diff;
    col += vec3(0.35, 0.03, 0.07) * fill * 0.6;
    col += vec3(0.85, 0.9, 1.0) * spec * 1.1;             // холодный блик
    col += vec3(0.7, 0.08, 0.14) * spec2 * 0.25;
    col += mix(vec3(0.45, 0.5, 0.62), vec3(0.75, 0.10, 0.17), 0.55) * fres * (0.55 + 0.35*uEnergy);
    gl_FragColor = vec4(col, 1.0);
  }`;

  const W = {
    ok: false, energy: 0.3, target: 0.3, pulse: 0, visible: true, t: 0,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    mouse: { x: 0, y: 0 },
  };

  W.init = function (canvas) {
    if (!window.THREE) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch (e) { canvas.style.display = 'none'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 6.2);

    const uniforms = { uTime: { value: 0 }, uEnergy: { value: 0.3 }, uPulse: { value: 0 } };
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 96),
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms })
    );
    const group = new THREE.Group();
    group.add(blob);
    scene.add(group);

    // холодная пыль вокруг
    const N = 700, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = 1.7 + Math.random() * 2.6, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.55;
      pos[i * 3 + 2] = r * Math.cos(ph);
      seed[i] = Math.random();
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const dust = new THREE.Points(pg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: uniforms.uTime, uEnergy: uniforms.uEnergy, uPR: { value: renderer.getPixelRatio() } },
      vertexShader: `attribute float seed; uniform float uTime; uniform float uEnergy; uniform float uPR; varying float vA; varying float vS;
        void main(){ vec3 p=position; float a=uTime*(0.04+0.05*seed)*(0.6+uEnergy);
          p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz; p.y+=sin(uTime*0.5+seed*20.0)*0.06;
          vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv;
          gl_PointSize=(1.2+2.2*seed)*uPR*(5.0/-mv.z); vA=0.25+0.55*seed; vS=seed; }`,
      fragmentShader: `varying float vA; varying float vS; uniform float uEnergy;
        void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5) discard;
          vec3 c = vS>0.82 ? vec3(0.85,0.12,0.2) : vec3(0.62,0.66,0.78);
          gl_FragColor=vec4(c,(1.0-d*2.0)*vA*(0.35+0.4*uEnergy)); }`,
    }));
    scene.add(dust);

    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // сфера чуть выше центра, чтобы под ней жил заголовок
      camera.setViewOffset(w, h, 0, h * 0.07, w, h);
      camera.updateProjectionMatrix();
      const s = Math.min(1.1, Math.max(0.6, h / 760));
      group.scale.setScalar(s);
    }
    new ResizeObserver(resize).observe(canvas);
    resize();

    window.addEventListener('mousemove', e => {
      W.mouse.x = (e.clientX / window.innerWidth - 0.5);
      W.mouse.y = (e.clientY / window.innerHeight - 0.5);
    });

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (W.visible && !document.hidden) {
        W.energy += (W.target - W.energy) * Math.min(1, dt * 1.6);
        W.pulse *= Math.pow(0.12, dt);
        W.t += W.reduced ? 0 : dt * (0.6 + 1.1 * W.energy);
        uniforms.uTime.value = W.t;
        uniforms.uEnergy.value = W.energy;
        uniforms.uPulse.value = W.pulse;
        group.rotation.y += ((W.mouse.x * 0.5) - group.rotation.y) * dt * 2 + dt * 0.05;
        group.rotation.x += ((W.mouse.y * 0.35) - group.rotation.x) * dt * 2;
        const breath = 1 + Math.sin(W.t * 1.7) * 0.012 * (0.4 + W.energy) + W.pulse * 0.06;
        blob.scale.setScalar(breath);
        renderer.render(scene, camera);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    W.ok = true;
  };
  W.setEnergy = v => { W.target = v; };
  W.kick = () => { W.pulse = 1; };
  W.setVisible = v => { W.visible = v && !W.lite; };
  window.Wave3D = W;
})();
