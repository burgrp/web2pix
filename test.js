const puppeteer = require("puppeteer");
const PNG = require("png-js");
// const PNG = require("pngjs");

const mqtt = require("mqtt")

async function createWeb2Pix() {

    const browser = await puppeteer.launch();

    let cnt = 0;

    function decodePngBuffer(buffer) {
        return new Promise((resolve, reject) => {
            let png = new PNG(buffer);
            png.decodePixels(pixels => resolve(pixels));
        });
    }

    return {
        async watchPage(url, width, height, cb) {

            const page = await browser.newPage();
            page.setViewport({ width, height })
            page.goto(url);

            let lastPixels;

            async function check() {
                try {
                    let pixels = await decodePngBuffer(await page.screenshot({ type: "png" }));

                    let x1, y1, x2, y2;

                    if (lastPixels) {
                        for (let y = 0; y < height; y++) {
                            for (let x = 0; x < width; x++) {
                                for (let b = 0; b < 4; b++) {
                                    let index = (y * width + x) * 4 + b;
                                    if (pixels[index] !== lastPixels[index]) {
                                        if (x1 == undefined || x < x1) x1 = x;
                                        if (y1 == undefined || y < y1) y1 = y;
                                        if (x2 == undefined || x > x2) x2 = x;
                                        if (y2 == undefined || y > y2) y2 = y;
                                    }
                                }
                            }
                        }
                    } else {
                        x1 = 0;
                        y1 = 0;
                        x2 = width - 1;
                        y2 = height - 1;
                    }

                    lastPixels = pixels;

                    if (x1 !== undefined) {
                        await cb({ x1, y1, x2, y2, width, height, pixels });
                    }

                } catch (e) {
                    console.error(e);
                }
                setTimeout(check, 500);
            }

            await check();
        }
    }
}

async function createDisplay(client, address) {

    return {
        async update(change) {

            let pixels = change.pixels;

            let rptIndex;
            let rptCount;

            let first = true;
            let buffer = [];

            function write(last, ...bytes) {
                buffer = buffer.concat(bytes);
                if (buffer.length > 1000 || last) {                    

                    function send(message) {
                        console.info(message);
                        client.publish(address + "/screen/write", Buffer.from(message));
                    }

                    if (first) {
                        let word = w => [w >> 8, w & 0xFF];
                        let head = [
                            ...word(change.x1 + 2), ...word(change.x2 + 2),
                            ...word(change.y1 + 1), ...word(change.y2 + 1)
                        ];
                        if (last) {
                            send([0x00, ...head, ...buffer]);
                        } else {
                            send([0x01, ...head, ...buffer]);
                        }
                    } else {
                        if (last) {
                            send([0x03, ...buffer]);
                        } else {
                            send([0x02, ...buffer]);
                        }
                    }

                    buffer = [];
                    first = false;
                }
            }

            function flushRpt(last) {
                if (rptCount > 1) {
                    write(last, 1, rptCount >> 8, rptCount & 0xFF, pixels[rptIndex + 2], pixels[rptIndex + 1], pixels[rptIndex]);
                } else {
                    if (pixels[rptIndex + 2] === 1) {
                        write(last, 1, 0, 0, pixels[rptIndex + 1], pixels[rptIndex]);
                    } else {
                        write(last, pixels[rptIndex + 2], pixels[rptIndex + 1], pixels[rptIndex]);
                    }
                }
            }

            for (let y = change.y1; y <= change.y2; y++) {
                for (let x = change.x1; x <= change.x2; x++) {
                    let index = (y * change.width + x) * 4;
                    if (rptIndex === undefined) {
                        rptIndex = index;
                        rptCount = 1;
                    } else {
                        if (pixels[rptIndex] === pixels[index] && pixels[rptIndex + 1] === pixels[index + 1] && pixels[rptIndex + 2] === pixels[index + 2]) {
                            rptCount++;
                        } else {
                            flushRpt(false);
                            rptIndex = index;
                            rptCount = 1;
                        }
                    }
                }
            }
            flushRpt(true);

        }
    }
}

async function test() {

    const web2pix = await createWeb2Pix();

    const client = mqtt.connect("mqtt://localhost")

    client.on("connect", async () => {

        const display = await createDisplay(client, "esp8266_115CC6");

        let url = "http://www.clocktab.com/";
        //let url = "https://static1.squarespace.com/static/5841944cf7e0ab4b3cc18ae4/t/5841a14c725e25c7bd5cb08d/1480696142541/Rectangle+Copy.png?format=1500w";
        //let url = "http://www.clker.com/cliparts/X/0/I/1/B/2/color-spectrum-md.png";
        
        web2pix.watchPage(url, 128, 128, async change => {
            console.info("Change", change);
            await display.update(change);
        });

    });

}

test().catch(console.error);
