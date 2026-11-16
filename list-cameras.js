// Prints the cameras the SmartSpectra SDK can see, so you can pick one by name.
// Run:  npm run cameras      (opens no camera and uses no SDK minutes)
const { SmartSpectraSDK } = require('@smartspectra/node-sdk');

const cams = SmartSpectraSDK.availableCameras();
if (!cams.length) {
  console.log('No cameras found.');
} else {
  console.log('Cameras the SDK can see:');
  for (const c of cams) console.log(`  - ${c.name}`);
  console.log('\nTo use one, put part of its name in the .env file, for example:');
  console.log(`  PRESAGE_CAMERA_NAME=${(cams[cams.length - 1].name || '').split(' ')[0]}`);
}
