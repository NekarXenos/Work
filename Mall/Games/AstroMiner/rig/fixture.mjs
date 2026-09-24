/* fixture.mjs — a SYNTHETIC body with deterministic geometry.
   The plan's own rule: a geometry-dependent assertion is either driven by
   deterministic synthetic geometry or it owns the RNG. A real streamed
   earthlike makes "did the spear land" a function of which hillside seed 7
   happened to put in front of Bleaux; a sphere of known radius makes the same
   assertion a fact about the FLIGHT.

   ACTIVE BODY. `activeBody` is a module `let` and an ESM export binding is
   read-only, so a test cannot assign it. exitRocket() is the shipped function
   that sets it SYNCHRONOUSLY from rocketState.landedBody, on its third line,
   before it touches anything else — so pointing rocketState at the fixture and
   calling it hands the fixture to the game through a real code path. It then
   throws on the null rocket a line later, which is caught and is not the part
   under test. */
export function makeBody(G,THREE,{R=200,at=[0,0,0]}={}){
    const body={
        name:'FIXTURE',type:'earthlike',streamed:false,
        position:new THREE.Vector3(...at),
        surfaceR:R,gridSize:64,blockSize:1,noiseAmp:0,
        group:new THREE.Group(),
        cubes:[],boulders:[],logs:[],oceans:null,
        bubble:{exposed:false,collected:false},
    };
    /* the ground: one sphere of KNOWN radius, so "how far did it fly before it
       hit the ground" has a closed-form answer to compare against. */
    const geo=new THREE.SphereGeometry(R,64,48);
    body.mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial());
    body.group.add(body.mesh);
    body.group.position.copy(body.position);          // ORIGIN is (0,0,0) headless
    body.group.updateMatrixWorld(true);
    return body;
}
export function activate(G,body){
    G.rocketState.landedBody=body;
    try{G.exitRocket();}catch(e){/* the null rocket, one line after activeBody=b */}
    return G.activeBody===body;
}
/* stand Bleaux on the fixture at `dir`, looking along `look`. */
export function stand(G,THREE,body,dir,look){
    const d=new THREE.Vector3(...dir).normalize();
    G.player.position.copy(body.position).addScaledVector(d,body.surfaceR+2);
    G.player.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d);
    const l=new THREE.Vector3(...look).normalize();
    /* the aim ray is the CAMERA's. Point the camera at the player and along
       `look`; aimRay() advances the origin to the player's own projection in
       third person, which is the shipped correction and is left running. */
    G.camera.position.copy(G.player.position);
    G.camera.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),l);
    G.camera.updateMatrixWorld(true);
    return d;
}
