/**
 * Print the URLs this dev server is reachable at — including the LAN one a
 * phone needs.
 *
 * `nx serve --host 0.0.0.0` binds every interface but only ever prints
 * `localhost`, so testing on a real device meant going and looking up the
 * Mac's IP by hand every time the network handed out a new one. The emulators
 * already bind 0.0.0.0 (firebase.json) and the app derives its emulator host
 * from `location.hostname` (environments/environment.ts), so the LAN origin
 * below is genuinely all a phone needs — app, auth, Firestore, functions and
 * storage all follow it.
 */
import { networkInterfaces } from 'node:os';

const PORT = process.env['DEV_PORT'] ?? '4200';

/** Every non-internal IPv4 — Wi-Fi first, since that is the phone's route. */
function lanAddresses() {
  const found = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      // `family` is the string 'IPv4' on Node 18+ and the number 4 on some
      // older builds; accept both rather than pinning to one runtime.
      const isV4 = address.family === 'IPv4' || address.family === 4;
      if (isV4 && !address.internal) found.push({ name, ip: address.address });
    }
  }
  // en0 is Wi-Fi on a Mac; put it first so the obvious line is the right one.
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const lan = lanAddresses();
const line = '─'.repeat(46);

console.log(`\n${line}`);
console.log(`  Local    http://localhost:${PORT}`);
if (lan.length === 0) {
  console.log('  Network  unavailable — no external IPv4 interface.');
  console.log('           A phone cannot reach this machine right now.');
} else {
  for (const { name, ip } of lan) {
    console.log(`  Network  http://${ip}:${PORT}   (${name})`);
  }
  console.log('\n  Open the Network URL on a phone on the same Wi-Fi.');
  console.log('  Emulators follow that host automatically.');
}
console.log(`${line}\n`);
