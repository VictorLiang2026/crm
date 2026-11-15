'use strict';
const {Browser:ProjectBrowser}=require('../regression/browser.cjs');

// Reuse the project's direct CDP driver and offline SDK fixtures. No production calls.
// The socket transport avoids Edge's Windows pipe startup and Puppeteer frame races.
class Browser extends ProjectBrowser {
  async start(){
    await super.start();
    await this.openConsole('#/more','authCase=1');
    await this.wait("Boolean(document.querySelector('.more-primary'))",30000);
  }
  setViewport(width,height){
    return this.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  }
}
module.exports={Browser};
