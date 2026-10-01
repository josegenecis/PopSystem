import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareSystemPrintData } from './system-print-data.js'
test('macOS USB adds status after all raster and cut bytes without corrupting them', () => {
  const bytes = Buffer.from([0xff,0x80,0x1d,0x56,0])
  assert.deepEqual(prepareSystemPrintData(bytes,'darwin','usb:///receipt'), Buffer.concat([bytes,Buffer.from([16,4,1])]))
  assert.deepEqual(prepareSystemPrintData(bytes.toString('binary'),'darwin','usb:///receipt'), Buffer.concat([bytes,Buffer.from([16,4,1])]))
})
test('does not change Windows, Linux or network queues', () => {
  for (const [os,uri] of [['win32','usb:'],['linux','usb:'],['darwin','socket://printer'],['darwin','']]) {
    const data=Buffer.from([255]); assert.equal(prepareSystemPrintData(data,os,uri),data)
  }
})
