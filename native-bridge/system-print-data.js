// CUPS USB on macOS waits for its read thread after writing each job.
// A standard ESC/POS real-time status reply releases that pending read.
// Preserve binary raster/QR bytes; do not apply this to network or other OS queues.
export function prepareSystemPrintData(data, platform, deviceUri = '') {
  if (platform !== 'darwin' || !String(deviceUri).startsWith('usb:')) return data
  return Buffer.concat([Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary'), Buffer.from([0x10, 0x04, 0x01])])
}
