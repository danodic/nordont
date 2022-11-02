/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = 'nordont-vpn-status-display';

const {GObject, GLib, St, Clutter} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ByteArray = imports.byteArray;
const Gio = imports.gi.Gio;

const _ = ExtensionUtils.gettext;

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {

        _init() {
            super._init(0.0, _('Nordon´t VPN Status Display'));

            this.label = new St.Label({
                text: 'Checking VPN Status...',
                y_align: Clutter.ActorAlign.CENTER
            });

            this.disconnected_notification_status = {
                since: undefined,
                counter: 0
            }

            this.add_child(this.label);

            this.scheduleTask();
        }

        scheduleTask() {
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                execCommunicate(["nordvpn", "status"])
                    .then(output => this.parseOutput(output))
                    .then(attributes => this.createLabelText(attributes))
                    .then((attributes) => this.notifyDisconnection(attributes));
                return GLib.SOURCE_CONTINUE;
            });
        }

        parseOutput(output) {
            const attributes = {};
            output.split(/\n/).forEach((row) => {
                if (row.trim().includes("Status:")) {
                    attributes.status = row.split(": ")[1]
                } else if (row.trim().includes("Country:")) {
                    attributes.country = row.split(": ")[1]
                } else if (row.trim().includes("City:")) {
                    attributes.city = row.split(": ")[1]
                } else if (row.trim().includes("Uptime:")) {
                    attributes.uptime = row.split(": ")[1]
                }
            });
            return attributes;
        }

        createLabelText(attributes) {
            if (attributes.status === "Connected") {
                this.label.text = `VPN Connected to ${attributes.city} - ${attributes.country}`;
            } else {
                this.label.text = "VPN Disconnected";
            }
            return attributes;
        }

        notifyDisconnection(attributes) {
            if (attributes.status === "Disconnected") {
                this.disconnected_notification_status.counter++;
                if (this.disconnected_notification_status.since === undefined) {
                    this.disconnected_notification_status.since = Date();
                }
                if (this.disconnected_notification_status.counter % 10 === 0) {
                    Main.notify(_(`VPN Disconnected since ${this.disconnected_notification_status.since}`));
                }
            } else {
                this.disconnected_notification_status.counter = 0;
                this.disconnected_notification_status.since = undefined;
            }
        }
    });


async function execCommunicate(argv, input = null, cancellable = null) {
    let cancelId = 0;
    let flags = (Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE);

    if (input !== null)
        flags |= Gio.SubprocessFlags.STDIN_PIPE;

    let proc = new Gio.Subprocess({
        argv: argv,
        flags: flags
    });
    proc.init(cancellable);

    if (cancellable instanceof Gio.Cancellable) {
        cancelId = cancellable.connect(() => proc.force_exit());
    }

    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(input, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                let status = proc.get_exit_status();

                if (status !== 0) {
                    throw new Gio.IOErrorEnum({
                        code: Gio.io_error_from_errno(status),
                        message: stderr ? stderr.trim() : GLib.strerror(status)
                    });
                }

                resolve(stdout.trim());
            } catch (e) {
                reject(e);
            } finally {
                if (cancelId > 0) {
                    cancellable.disconnect(cancelId);
                }
            }
        });
    });
}

class Extension {
    constructor(uuid) {
        this._uuid = uuid;

        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}
