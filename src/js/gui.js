
'use strict';

window.TABS = {}; // filled by individual tab js file

const GUI_MODES = {
    NWJS: "NW.js",
    Cordova: "Cordova",
    Other: "Other",
};

const GuiControl = function () {
    this.auto_connect = false;
    this.connecting_to = false;
    this.connected_to = false;
    this.connect_lock = false;
    this.active_tab = null;
    this.tab_switch_in_progress = false;
    this.operating_system = null;
    this.interval_array = [];
    this.timeout_array = [];
    this.buttonDisabledClass = "disabled";

    this.defaultAllowedTabsWhenDisconnected = [
        'landing',
        'changelog',
        'firmware_flasher',
        'privacy_policy',
        'options',
        'help',
    ];
    this.defaultAllowedFCTabsWhenConnected = [
        'setup',
        'failsafe',
        'transponder',
        'osd',
        'power',
        'adjustments',
        'auxiliary',
        'presets',
        'cli',
        'configuration',
        'gps',
        'led_strip',
        'logging',
        'onboard_logging',
        'modes',
        'motors',
        'pid_tuning',
        'ports',
        'receiver',
        'sensors',
        'servos',
        'vtx',
    ];

    this.allowedTabs = this.defaultAllowedTabsWhenDisconnected;

    // check which operating system is user running
    this.operating_system = GUI_checkOperatingSystem();

    // Check the method of execution
    this.nwGui = null;
    try {
        this.nwGui = require('nw.gui');
        this.Mode = GUI_MODES.NWJS;
    } catch (ex) {
        if (typeof cordovaApp !== 'undefined') {
            this.Mode = GUI_MODES.Cordova;
        } else {
            this.Mode = GUI_MODES.Other;
        }
    }
};

function GUI_checkOperatingSystem() {
    return navigator?.userAgentData?.platform || 'Android';
}

// Timer managing methods

// name = string
// code = function reference (code to be executed)
// interval = time interval in miliseconds
// first = true/false if code should be ran initially before next timer interval hits
GuiControl.prototype.interval_add = function (name, code, interval, first) {
    const data = {'name': name, 'timer': null, 'code': code, 'interval': interval, 'fired': 0, 'paused': false};

    if (first === true) {
        code(); // execute code

        data.fired++; // increment counter
    }

    data.timer = setInterval(function() {
        code(); // execute code

        data.fired++; // increment counter
    }, interval);

    this.interval_array.push(data); // push to primary interval array

    return data;
};

// name = string
// code = function reference (code to be executed)
// interval = time interval in miliseconds
// first = true/false if code should be ran initially before next timer interval hits
// condition = function reference with true/false result, a condition to be checked before every interval code execution
GuiControl.prototype.interval_add_condition = function (name, code, interval, first, condition) {
    this.interval_add(name, () => {
        if (condition()) {
            code();
        } else {
            this.interval_remove(name);
        }
    }, interval, first);
};

// name = string
GuiControl.prototype.interval_remove = function (name) {
    for (let i = 0; i < this.interval_array.length; i++) {
        if (this.interval_array[i].name === name) {
            clearInterval(this.interval_array[i].timer); // stop timer

            this.interval_array.splice(i, 1); // remove element/object from array

            return true;
        }
    }

    return false;
};

// name = string
GuiControl.prototype.interval_pause = function (name) {
    for (let i = 0; i < this.interval_array.length; i++) {
        if (this.interval_array[i].name === name) {
            clearInterval(this.interval_array[i].timer);
            this.interval_array[i].paused = true;

            return true;
        }
    }

    return false;
};

// name = string
GuiControl.prototype.interval_resume = function (name) {

    function executeCode(obj) {
        obj.code(); // execute code
        obj.fired++; // increment counter
    }

    for (let i = 0; i < this.interval_array.length; i++) {
        if (this.interval_array[i].name === name && this.interval_array[i].paused) {
            const obj = this.interval_array[i];

            obj.timer = setInterval(executeCode, obj.interval, obj);

            obj.paused = false;

            return true;
        }
    }

    return false;
};

// input = array of timers thats meant to be kept, or nothing
// return = returns timers killed in last call
GuiControl.prototype.interval_kill_all = function (keepArray) {
    const self = this;
    let timersKilled = 0;

    for (let i = (this.interval_array.length - 1); i >= 0; i--) { // reverse iteration
        let keep = false;
        if (keepArray) { // only run through the array if it exists
            keepArray.forEach(function (name) {
                if (self.interval_array[i].name === name) {
                    keep = true;
                }
            });
        }

        if (!keep) {
            clearInterval(this.interval_array[i].timer); // stop timer

            this.interval_array.splice(i, 1); // remove element/object from array

            timersKilled++;
        }
    }

    return timersKilled;
};

// name = string
// code = function reference (code to be executed)
// timeout = timeout in miliseconds
GuiControl.prototype.timeout_add = function (name, code, timeout) {
    const self = this;
    const data = {'name': name,
                  'timer': null,
                  'timeout': timeout,
                 };

    // start timer with "cleaning" callback
    data.timer = setTimeout(function() {
        code(); // execute code

        // remove object from array
        const index = self.timeout_array.indexOf(data);
        if (index > -1) {
            self.timeout_array.splice(index, 1);
        }
    }, timeout);

    this.timeout_array.push(data); // push to primary timeout array

    return data;
};

// name = string
GuiControl.prototype.timeout_remove = function (name) {
    for (let i = 0; i < this.timeout_array.length; i++) {
        if (this.timeout_array[i].name === name) {
            clearTimeout(this.timeout_array[i].timer); // stop timer

            this.timeout_array.splice(i, 1); // remove element/object from array

            return true;
        }
    }

    return false;
};

// no input parameters
// return = returns timers killed in last call
GuiControl.prototype.timeout_kill_all = function () {
    let timersKilled = 0;

    for (let i = 0; i < this.timeout_array.length; i++) {
        clearTimeout(this.timeout_array[i].timer); // stop timer

        timersKilled++;
    }

    this.timeout_array = []; // drop objects

    return timersKilled;
};

// message = string
GuiControl.prototype.log = function (message) {
    const commandLog = $('div#log');
    const d = new Date();
    const year = d.getFullYear();
    const month = (d.getMonth() < 9) ? `0${d.getMonth() + 1}` : (d.getMonth() + 1);
    const date =  (d.getDate() < 10) ? `0${d.getDate()}` : d.getDate();
    const hours = (d.getHours() < 10) ? `0${d.getHours()}` : d.getHours();
    const minutes = (d.getMinutes() < 10) ? `0${d.getMinutes()}` : d.getMinutes();
    const seconds = (d.getSeconds() < 10) ? `0${d.getSeconds()}` : d.getSeconds();
    const time = `${hours}:${minutes}:${seconds}`;

    const formattedDate = `${year}-${month}-${date} @${time}`;
    $('div.wrapper', commandLog).append(`<p>${formattedDate} -- ${message}</p>`);
    commandLog.scrollTop($('div.wrapper', commandLog).height());
};

// Method is called every time a valid tab change event is received
// callback = code to run when cleanup is finished
// default switch doesn't require callback to be set
GuiControl.prototype.tab_switch_cleanup = function (callback) {
    MSP.callbacks_cleanup(); // we don't care about any old data that might or might not arrive
    this.interval_kill_all(); // all intervals (mostly data pulling) needs to be removed on tab switch

    if (this.active_tab && TABS[this.active_tab]) {
        TABS[this.active_tab].cleanup(callback);
    } else {
        callback();
    }
};

GuiControl.prototype.switchery = function() {

    const COLOR_ACCENT = 'var(--accent)';
    const COLOR_SWITCHERY_SECOND = 'var(--switcherysecond)';

    $('.togglesmall').each(function(index, elem) {
        const switchery = new Switchery(elem, {
            size: 'small',
            color: COLOR_ACCENT,
            secondaryColor: COLOR_SWITCHERY_SECOND,
        });
        $(elem).on("change", function () {
            switchery.setPosition();
        });
        $(elem).removeClass('togglesmall');
    });

    $('.toggle').each(function(index, elem) {
        const switchery = new Switchery(elem, {
            color: COLOR_ACCENT,
            secondaryColor: COLOR_SWITCHERY_SECOND,
        });
        $(elem).on("change", function () {
            switchery.setPosition();
        });
        $(elem).removeClass('toggle');
    });

    $('.togglemedium').each(function(index, elem) {
        const switchery = new Switchery(elem, {
            className: 'switcherymid',
            color: COLOR_ACCENT,
            secondaryColor: COLOR_SWITCHERY_SECOND,
        });
         $(elem).on("change", function () {
             switchery.setPosition();
         });
         $(elem).removeClass('togglemedium');
    });
};

GuiControl.prototype.content_ready = function (callback) {

    this.switchery();

    if (CONFIGURATOR.connectionValid) {
        // Build link to in-use CF version documentation
        const documentationButton = $('div#content #button-documentation');
        documentationButton.html("Wiki");
        documentationButton.attr("href","https://github.com/betaflight/betaflight/wiki");
    }

    // loading tooltip
    jQuery(function() {

        new jBox('Tooltip', {
            attach: '.cf_tip',
            trigger: 'mouseenter',
            closeOnMouseleave: true,
            closeOnClick: 'body',
            delayOpen: 100,
            delayClose: 100,
            position: {
                x: 'right',
                y: 'center',
            },
            outside: 'x',
        });

        new jBox('Tooltip', {
            theme: 'Widetip',
            attach: '.cf_tip_wide',
            trigger: 'mouseenter',
            closeOnMouseleave: true,
            closeOnClick: 'body',
            delayOpen: 100,
            delayClose: 100,
            position: {
                x: 'right',
                y: 'center',
            },
            outside: 'x',
        });
    });

    if (callback) {
        callback();
    }
};

GuiControl.prototype.selectDefaultTabWhenConnected = function() {
    const result = ConfigStorage.get(['rememberLastTab', 'lastTab']);
    const tab = result.rememberLastTab && result.lastTab ? result.lastTab : 'tab_setup';

    $(`#tabs ul.mode-connected .${tab} a`).trigger('click');
};

GuiControl.prototype.isNWJS = function () {
  return this.Mode === GUI_MODES.NWJS;
};

GuiControl.prototype.isCordova = function () {
    return this.Mode === GUI_MODES.Cordova;
  };
GuiControl.prototype.isOther = function () {
  return this.Mode === GUI_MODES.Other;
};


GuiControl.prototype.showYesNoDialog = function(yesNoDialogSettings) {
    // yesNoDialogSettings:
    // title, text, buttonYesText, buttonNoText, buttonYesCallback, buttonNoCallback
    const dialog = $(".dialogYesNo");
    const title = dialog.find(".dialogYesNoTitle");
    const content = dialog.find(".dialogYesNoContent");
    const buttonYes = dialog.find(".dialogYesNo-yesButton");
    const buttonNo = dialog.find(".dialogYesNo-noButton");

    title.html(yesNoDialogSettings.title);
    content.html(yesNoDialogSettings.text);
    buttonYes.html(yesNoDialogSettings.buttonYesText);
    buttonNo.html(yesNoDialogSettings.buttonNoText);

    buttonYes.off("click");
    buttonNo.off("click");

    buttonYes.on("click", () => {
        dialog[0].close();
        yesNoDialogSettings.buttonYesCallback?.();
    });

    buttonNo.on("click", () => {
        dialog[0].close();
        yesNoDialogSettings.buttonNoCallback?.();
    });

    dialog[0].showModal();
};

GuiControl.prototype.showWaitDialog = function(waitDialogSettings) {
    // waitDialogSettings:
    // title, buttonCancelCallback
    const dialog = $(".dialogWait")[0];
    const title = $(".dialogWaitTitle");
    const buttonCancel = $(".dialogWait-cancelButton");

    title.html(waitDialogSettings.title);
    buttonCancel.toggle(!!waitDialogSettings.buttonCancelCallback);

    buttonCancel.off("click");

    buttonCancel.on("click", () => {
        dialog.close();
        waitDialogSettings.buttonCancelCallback?.();
    });

    dialog.showModal();
    return dialog;
};

GuiControl.prototype.showInformationDialog = function(informationDialogSettings) {
    // informationDialogSettings:
    // title, text, buttonConfirmText
    return new Promise(resolve => {
        const dialog = $(".dialogInformation");
        const title = dialog.find(".dialogInformationTitle");
        const content = dialog.find(".dialogInformationContent");
        const buttonConfirm = dialog.find(".dialogInformation-confirmButton");

        title.html(informationDialogSettings.title);
        content.html(informationDialogSettings.text);
        buttonConfirm.html(informationDialogSettings.buttonConfirmText);

        buttonConfirm.off("click");

        buttonConfirm.on("click", () => {
            dialog[0].close();
            resolve();
        });

        dialog[0].showModal();
    });
};

GuiControl.prototype.saveToTextFileDialog = function(textToSave, suggestedFileName, extension) {
    return new Promise((resolve, reject) => {
        const accepts = [{ description: `${extension.toUpperCase()} files`, extensions: [extension] }];

        chrome.fileSystem.chooseEntry(
            {
                type: 'saveFile',
                suggestedName: suggestedFileName,
                accepts: accepts,
            },
            entry => this._saveToTextFileDialogFileSelected(entry, textToSave, resolve, reject),
        );
    });
};

GuiControl.prototype._saveToTextFileDialogFileSelected = function(entry, textToSave, resolve, reject) {
    checkChromeRuntimeError();

    if (!entry) {
        console.log('No file selected for saving');
        resolve(false);
        return;
    }

    entry.createWriter(writer => {
        writer.onerror = () => {
            reject();
            console.error('Failed to write file');
        };

        writer.onwriteend = () => {
            if (textToSave.length > 0 && writer.length === 0) {
                writer.write(new Blob([textToSave], {type: 'text/plain'}));
            } else {
                resolve(true);
                console.log('File write complete');
            }
        };

        writer.truncate(0);
    },
    () => {
        reject();
        console.error('Failed to get file writer');
    });
};

GuiControl.prototype.readTextFileDialog = function(extension) {
    const accepts = [{ description: `${extension.toUpperCase()} files`, extensions: [extension] }];

    return new Promise(resolve => {
        chrome.fileSystem.chooseEntry({type: 'openFile', accepts: accepts}, function(entry) {
            checkChromeRuntimeError();

            if (!entry) {
                console.log('No file selected for loading');
                resolve(false);
                return;
            }

            entry.file((file) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => {
                    console.error(reader.error);
                    reject();
                };
                reader.readAsText(file);
            });
        });
    });
};

GuiControl.prototype.escapeHtml = function(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

GuiControl.prototype.addLinksTargetBlank = function(element) {
    element.find('a').each(function() {
        $(this).attr('target', '_blank');
    });
};

// initialize object into GUI variable
window.GUI = new GuiControl();
