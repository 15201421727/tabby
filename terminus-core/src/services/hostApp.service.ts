import * as path from 'path'
import shellEscape = require('shell-escape')
import { Observable, Subject } from 'rxjs'
import { Injectable, NgZone, EventEmitter } from '@angular/core'
import { ElectronService } from './electron.service'
import { Logger, LogService } from './log.service'

export enum Platform {
    Linux, macOS, Windows,
}

export interface Bounds {
    x: number
    y: number
    width: number
    height: number
}

@Injectable({ providedIn: 'root' })
export class HostAppService {
    platform: Platform
    nodePlatform: string
    shown = new EventEmitter<any>()
    isFullScreen = false
    private preferencesMenu = new Subject<void>()
    private secondInstance = new Subject<void>()
    private cliOpenDirectory = new Subject<string>()
    private cliRunCommand = new Subject<string[]>()
    private cliPaste = new Subject<string>()
    private cliOpenProfile = new Subject<string>()
    private configChangeBroadcast = new Subject<void>()
    private windowCloseRequest = new Subject<void>()
    private windowMoved = new Subject<void>()
    private displayMetricsChanged = new Subject<void>()
    private logger: Logger
    private windowId: number

    get preferencesMenu$ (): Observable<void> { return this.preferencesMenu }
    get secondInstance$ (): Observable<void> { return this.secondInstance }
    get cliOpenDirectory$ (): Observable<string> { return this.cliOpenDirectory }
    get cliRunCommand$ (): Observable<string[]> { return this.cliRunCommand }
    get cliPaste$ (): Observable<string> { return this.cliPaste }
    get cliOpenProfile$ (): Observable<string> { return this.cliOpenProfile }
    get configChangeBroadcast$ (): Observable<void> { return this.configChangeBroadcast }
    get windowCloseRequest$ (): Observable<void> { return this.windowCloseRequest }
    get windowMoved$ (): Observable<void> { return this.windowMoved }
    get displayMetricsChanged$ (): Observable<void> { return this.displayMetricsChanged }

    constructor (
        private zone: NgZone,
        private electron: ElectronService,
        log: LogService,
    ) {
        this.logger = log.create('hostApp')
        this.nodePlatform = require('os').platform()
        this.platform = {
            win32: Platform.Windows,
            darwin: Platform.macOS,
            linux: Platform.Linux
        }[this.nodePlatform]

        this.windowId = parseInt(location.search.substring(1))
        this.logger.info('Window ID:', this.windowId)

        electron.ipcRenderer.on('host:preferences-menu', () => this.zone.run(() => this.preferencesMenu.next()))

        electron.ipcRenderer.on('uncaughtException', (_$event, err) => {
            this.logger.error('Unhandled exception:', err)
        })

        electron.ipcRenderer.on('host:window-enter-full-screen', () => this.zone.run(() => {
            this.isFullScreen = true
        }))

        electron.ipcRenderer.on('host:window-leave-full-screen', () => this.zone.run(() => {
            this.isFullScreen = false
        }))

        electron.ipcRenderer.on('host:window-shown', () => {
            this.zone.run(() => this.shown.emit())
        })

        electron.ipcRenderer.on('host:window-close-request', () => {
            this.zone.run(() => this.windowCloseRequest.next())
        })

        electron.ipcRenderer.on('host:window-moved', () => {
            this.zone.run(() => this.windowMoved.next())
        })

        electron.ipcRenderer.on('host:display-metrics-changed', () => {
            this.zone.run(() => this.displayMetricsChanged.next())
        })

        electron.ipcRenderer.on('host:second-instance', (_$event, argv: any, cwd: string) => this.zone.run(() => {
            this.logger.info('Second instance', argv)
            const op = argv._[0]
            if (op === 'open') {
                this.cliOpenDirectory.next(path.resolve(cwd, argv.directory))
            } else if (op === 'run') {
                this.cliRunCommand.next(argv.command)
            } else if (op === 'paste') {
                let text = argv.text
                if (argv.escape) {
                    text = shellEscape([text])
                }
                this.cliPaste.next(text)
            } else if (op === 'profile') {
                this.cliOpenProfile.next(argv.profileName)
            } else {
                this.secondInstance.next()
            }
        }))

        electron.ipcRenderer.on('host:config-change', () => this.zone.run(() => {
            this.configChangeBroadcast.next()
        }))
    }

    getWindow () {
        return this.electron.BrowserWindow.fromId(this.windowId)
    }

    newWindow () {
        this.electron.ipcRenderer.send('app:new-window')
    }

    getShell () {
        return this.electron.shell
    }

    getAppPath () {
        return this.electron.app.getAppPath()
    }

    getPath (type: string) {
        return this.electron.app.getPath(type)
    }

    toggleFullscreen () {
        let window = this.getWindow()
        window.setFullScreen(!this.isFullScreen)
    }

    openDevTools () {
        this.getWindow().webContents.openDevTools({ mode: 'undocked' })
    }

    focusWindow () {
        this.electron.ipcRenderer.send('window-focus')
    }

    minimize () {
        this.electron.ipcRenderer.send('window-minimize')
    }

    maximize () {
        this.electron.ipcRenderer.send('window-maximize')
    }

    unmaximize () {
        this.electron.ipcRenderer.send('window-unmaximize')
    }

    toggleMaximize () {
        this.electron.ipcRenderer.send('window-toggle-maximize')
    }

    setBounds (bounds: Bounds) {
        this.electron.ipcRenderer.send('window-set-bounds', bounds)
    }

    setAlwaysOnTop (flag: boolean) {
        this.electron.ipcRenderer.send('window-set-always-on-top', flag)
    }

    setVibrancy (enable: boolean, type: string) {
        document.body.classList.toggle('vibrant', enable)
        if (this.platform === Platform.macOS) {
            this.getWindow().setVibrancy(enable ? 'dark' : null)
        }
        if (this.platform === Platform.Windows) {
            this.electron.ipcRenderer.send('window-set-vibrancy', enable, type)
        }
    }

    setTitle (title: string) {
        this.electron.ipcRenderer.send('window-set-title', title)
    }

    setTouchBar (touchBar: Electron.TouchBar) {
        this.getWindow().setTouchBar(touchBar)
    }

    popupContextMenu (menuDefinition: Electron.MenuItemConstructorOptions[]) {
        this.electron.Menu.buildFromTemplate(menuDefinition).popup({})
    }

    broadcastConfigChange () {
        this.electron.ipcRenderer.send('app:config-change')
    }

    emitReady () {
        this.electron.ipcRenderer.send('app:ready')
    }

    bringToFront () {
        this.electron.ipcRenderer.send('window-bring-to-front')
    }

    closeWindow () {
        this.electron.ipcRenderer.send('window-close')
    }

    quit () {
        this.logger.info('Quitting')
        this.electron.app.quit()
    }
}