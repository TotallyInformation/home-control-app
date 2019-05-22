/*global document,$,window,uibuilder,Vue,_ */
/** Copyright (c) 2019 Julian Knight (Totally Information)

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
**/
/** This is the default, template Front-End JavaScript for uibuilder
 * It is usable as is though you will want to add your own code to
 * process incoming and outgoing messages.
 *
 * uibuilderfe.js (or uibuilderfe.min.js) exposes the following global object:
 * @see https://github.com/TotallyInformation/node-red-contrib-uibuilder/wiki/Front-End-Library---available-properties-and-methods
 **/
'use strict'

/** Get a nested property from an object without returning any errors.
 * If the property or property chain doesn't exist, undefined is returned.
 * Property names with spaces may use either dot or bracket "[]" notation.
 * Note that bracketed property names without surrounding quotes will fail the lookup.
 *      e.g. embedded variables are not supported.
 * @param {Object} obj The object to check
 * @param {string} prop The property or property chain to get (e.g. obj.prop1.prop1a or obj['prop1'].prop2)
 * @returns {*|undefined} The value of the objects property or undefined if the property doesn't exist
 */
function getProp(obj, prop) {
    if (typeof obj !== 'object') throw 'getProp: obj is not an object'
    if (typeof prop !== 'string') throw 'getProp: prop is not a string'

    // Replace [] notation with dot notation
    prop = prop.replace(/\[["'`](.*)["'`]\]/g,".$1")

    return prop.split('.').reduce(function(prev, curr) {
        return prev ? prev[curr] : undefined
    }, obj || self)
} // --- end of fn getProp() --- //

// Initialise Bootstrap-Vue: Not needed if loading via CDN
//Vue.use(BootstrapVue)

// Template Components
Vue.component('lights-tab', {
    // NB: prop defined as 'home-data' because it is used as an HTML attribute. BUT use as variable 'homeData'
    props: ['home-data', 'switches'],
    template: '#lights-tab-template',
    data: function() { return {
        dtOpts: {
            timeZone: 'Europe/London',
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: 'numeric',
        },
        dtFmt: 'en-GB',
    }},
    computed: {
        // orderedSwitches: function() {
        //     return _.orderBy(this.switches, 'room').filter(function (sw) {
        //         return sw.room === 'NA' ? false : true
        //     })
        // },
    },
    methods: {
        fmtTime: function(t) {
            return new Intl.DateTimeFormat(this.dtFmt, this.dtOpts).format(new Date(t))
        },
        switchClick: function(clickData) {
            let [switchId, switchStatus] = clickData
            //console.log('switchClick', switchId, switchStatus)
            uibuilder.send({
                'topic': `COMMAND/${switchId}`,
                'payload': switchStatus.toLowerCase() === 'on' ? 'Off' : 'On'
            })
        },
    },
})
Vue.component('demand-card', {
    props: [
        'percentage-demand', 'demand-level', 'demand-max',
        'demand-on-off-output', 'is-boosted',
    ],
    template: '#demand-card-template',
    computed: {
        classDemandActive: function() {
            return this.demandOnOffOutput === 'On' ? 'text-danger font-weight-bold': ''
        },
        isBoostedText: function() {
            return this.isBoosted ? 'On' : 'Off'
        },
        classIsBoosted: function() {
            return this.isBoosted ? 'text-danger font-weight-bold': ''
        },
    },
})
Vue.component('device-tab', {
    props: ['home-data', 'devices'],
    template: '#device-tab-template',
    data: function() { return {
        dtOpts: {
            timeZone: 'Europe/London',
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: 'numeric',
        },
        dtFmt: 'en-GB',
    }},
    computed: {
        orderedDevices: function() {
            // Use LoDash to reorder the object
            return _.orderBy(this.devices, 'id')
        },
    },
    methods: {
        fmtTime: function(t) {
            return new Intl.DateTimeFormat(this.dtFmt, this.dtOpts).format(new Date(t))
        },
    },
})

// Initialise Vue
new Vue({
    el: "#app",
    // We don't really need a function here but you do in components - keeping things consistent
    data: function() { return {
        // For formatting dates and times
        dtOpts: {
            timeZone: 'Europe/London',
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: 'numeric',
        },
        dtFmt: 'en-GB',
        // Which tab should be active?
        tabIndex: 0,
        // heating
        lastUpdate  : '[None]',
        hTimer      : null,
        showNoUpdAlert    : false,
        demand            : undefined,
        percentageDemand  : undefined,
        demandOnOffOutput : 'N/A',
        demandMax         : 100,
        isBoosted         : false,
        homeData          : [],
        // Field definitions - @see https://bootstrap-vue.js.org/docs/components/table#field-definition-reference
        homeDataFields    : [
            {   key: 'floor',
                label: 'Floor',
                sortable: true,
                class: 'border-right text-center',
                thStyle: {width: '2em !important'},
            },
            {   key: 'Name',
                label: 'Room',
                sortable: true,
                class: 'border-right',
                // Variant applies to the whole column, including the header and footer
                //variant: 'danger'
                tdClass: (value, key, item) => {
                    const c = []

                    if ( item.ControlOutputState === 'On' ) c.push('bg-primary')
                    if ( item.outside === true )            c.push('font-italic')

                    return c.join(' ')
                },
                tdAttr: {'title':'Blue BG = Room requesting heat. Italic = room is outside'},
            },
            {   key: 'CalculatedTemperature',
                label: '°c',
                sortable: true,
                class: 'text-right border-right',
                formatter: (value, key, item) => {
                    // -200 or -32768 are unset or invalid
                    if ( value < -99 ) return ''
                    const t = (value/10).toFixed(1)
                    return isNaN(t) ? value : t
                },
                tdClass: (value, key, item) => {
                    const c = []

                    // Highlight if too cold or too hot
                    if ( item.outside === true ) {
                        // Outdoors
                        c.push('font-italic')
                        if ( value < 0 )
                            // Freezing
                            c.push('bg-danger')
                        else if ( value < 20 )
                            // <2
                            c.push('bg-warning')
                        else if ( value < 50 )
                            // <5
                            c.push(['text-white', 'bg-primary'])
                        else if ( value > 300 )
                            // >30
                            c.push('bg-warning')
                    } else {
                        // Indoors
                        if ( value < 100 )
                            // <10
                            c.push('bg-danger')
                        else if ( value > 230 )
                            // >23
                            c.push('bg-warning')
                    }

                    //if ( item.ControlOutputState === 'On' ) c.push('bg-primary')

                    return c.join(' ')
                },
                tdAttr: {'title':"Temperature. Highlighted if too high or too low."},
            },
            {   key: 'CalculatedHumidity',
                label: 'H%',
                sortable: true,
                class: 'text-right',
                formatter: (value, key, item) => {
                    let h = Math.round(value)
                    h = isNaN(h) ? value : h
                    return h === undefined ? '' : h + '%'
                },
                tdClass: (value, key, item) => {
                    const c = []
                    // Highlight if too high or too low
                    if ( item.outside === true ) {
                        // Outdoors
                        c.push('font-italic')
                        if ( value <40 ) c.push(['text-white', 'bg-primary'])
                    } else {
                        // Indoors
                        if ( value <40 ) c.push(['text-white', 'bg-primary'])
                        else if (value >60 ) c.push('bg-warning')
                    }
                    return c.join(' ')
                },
                tdAttr: {'title':"Humidity. Highlighted if too high or too low."},
            },
            // A virtual column with custom formatter
            {   key: 'override',
                label: 'O/ride',
                class: 'border-left text-right',
                thStyle: {width: '2em !important'},
                formatter: (value, key, item) => {
                    if ( item.SetPointOrigin === undefined ) return false
                    else return item.SetPointOrigin!=='FromSchedule' ? true : false
                },
            },
            {   key: 'details',
                label: 'More',
                class: 'text-right',
                thStyle: {width: '2em !important'},
            },
        ],
        // For the details view of homeData table
        hdDetailsFields: [
            'ProductType','BatteryLevel','DisplayedSignalStrength',
            {   key: 'SetPoint',
                label: 'SetPoint °c',
                class: 'text-right',
                formatter: (value, key, item) => {
                    // -200 or -32768 are unset or invalid
                    if ( value < -99 ) return ''
                    const t = (value/10).toFixed(1)
                    return isNaN(t) ? value : t
                },
            },
            {   key: 'MeasuredTemperature',
                label: 'Measured °c',
                class: 'text-right',
                formatter: (value, key, item) => {
                    // -200 or -32768 are unset or invalid
                    if ( value < -99 ) return ''
                    const t = (value/10).toFixed(1)
                    return isNaN(t) ? value : t
                },
            },
            {   key: 'MeasuredHumidity',
                label: 'Measured Humidity',
                class: 'text-right',
                formatter: (value, key, item) => {
                    return value ? (value + '%') : ''
                },
            },
        ],
        // Current Switch Settings
        switches: {},
        // Current Device statuses
        devices: {},
    }}, // --- End of data --- //
    // computed: dynamic data, used as {{ cName }} - cached
    computed: {
        // Set the FG & BG of the demand card if demand is on
        qDemandBg: function() {
            return this.demandOnOffOutput === 'On' ? 'primary': ''
        },
        qDemandFg: function() {
            return this.demandOnOffOutput === 'On' ? 'white': ''
        },
        classDemandActive: function() {
            return this.demandOnOffOutput === 'On' ? 'text-danger': ''
        },
        // colour the demand bar depending on demand level
        demandLevel: function() {
            let a = null
            switch (true) {
                case ( typeof this.percentageDemand === 'string' ):
                    a = 'dark'
                    break

                case this.percentageDemand <= 30:
                    a = 'success'
                    break

                case this.percentageDemand <= 60:
                    a = 'warning'
                    break

                default:
                    a = 'danger'
                    break
            }
            return a
        },
        // If a room has boost turned on
        isBoostedFill: function() {
            return this.isBoosted ? 'fill:#dc3545' : 'fill:#ffc107'
        },
        isBoostedText: function() {
            return this.isBoosted ? 'On' : 'Off'
        },
    }, // --- End of computed --- //
    // methods:
    methods: {
        /** Return a setInterval timer for the heating update warning
         * @callback cb setInterval function
         * @param {number} timeout The timeout to be passed to the setInterval fn. Optional, defaults to 2 minutes.
         * @returns {cb} setInterval function
         */
        heatingUpdTimer: function(timeout=120000) {
            const viewApp = this
            return setInterval(function(){
                //console.log('Vue:methods:heatingUpdTimer heating update not received in 2 minutes')
                viewApp.showNoUpdAlert = true
            }, timeout)
        },
        /** Handle row-clicked event on rooms table
         * @param {Object} item The Row data for the clicked row
         * @param {number} index The row index for the clicked row
         * @param {Object} event The click event data
         **/
        // TODO: need separate array to maintain display state
        onRoomsRowClicked (item, index, event) {
            item._showDetails = !item._showDetails
        },
        // Filter Fn for heating room table - @see https://bootstrap-vue.js.org/docs/components/table#filtering
        currentRoomsTblFilter: function(item) {
            if ( item.CalculatedTemperature ) return true
            else return false
        },

        /** Invoked when user changes tab - saves current tab - @see mounted
         * @param {number} i Selected tab index number
         */
        changeTab: function(i) {
            // Save to browser's session storage
            sessionStorage.currentTab = i
        },

        // Format date/time
        fmtTime: function(t) {
            return new Intl.DateTimeFormat(this.dtFmt, this.dtOpts).format(new Date(t))
        },

        // return formatted HTML version of JSON object
        syntaxHighlight: function(json) {
            json = JSON.stringify(json, undefined, 4)
            json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                var cls = 'number'
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'key'
                    } else {
                        cls = 'string'
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'boolean'
                } else if (/null/.test(match)) {
                    cls = 'null'
                }
                return '<span class="' + cls + '">' + match + '</span>'
            })
        } // --- End of syntaxHighlight --- //

    }, // --- End of methods --- //

    // Available hooks: init,mounted,updated,destroyed
    mounted: function(){
        uibuilder.debug(false) // output uibuilderfe debug messages

        //console.debug('Vue:mounted - setting up uibuilder watchers')

        // Save confusion by keeping a specific reference to this Vue app
        const vueApp = this

        // Start countdown. If lastUpdate not updated in 2 minutes, show a warning.
        vueApp.hTimer = vueApp.heatingUpdTimer()

        // On-load Reset the current tab to the one saved in session storage - strange, stored as number but retrieves as a string
        vueApp.tabIndex =  Number(sessionStorage.currentTab)

        // If msg changes - msg is updated when a standard msg is received from Node-RED over Socket.IO
        // Note that you can also listen for 'msgsReceived' as they are updated at the same time
        // but newVal relates to the attribute being listened to.
        uibuilder.onChange('msg', function(newVal){
            //console.debug('Vue:mounted:UIBUILDER: property msg changed! ', newVal)
            vueApp.msgRecvd = newVal

            // What kind of message did we receive?
            // Use getProp so we don't pollute the original input. Then tidy the topic
            let topic = getProp(newVal, 'topic').replace(/\/SWITCH..$/,'')
            if ( topic.substring(0,8) === 'DEVICES/' ) topic = 'DEVICES'
            switch (topic) {
                // Full homeDetails
                case 'Home Details':
                    //console.debug('UIBUILDER:onChange:msg: homeDetails msg received ', newVal)
                    /** To update the home details, we are expecting a msg like:
                     *  msg = {
                     *      'topic'     : 'Home Details',
                     *      'payload'   : {
                     *          'homeDetails': homeDetails,  // ARRAY
                     *          'demand'    : demand,        // OBJECT
                     *          'lastUpdate': new Date(),
                     *      },
                     *  }
                     */
                    // for convenience
                    const data = newVal.payload

                    // Formatted last update
                    vueApp.lastUpdate = vueApp.fmtTime(data.lastUpdate)

                    // clear and restart countdown. If lastUpdate not updated in 2 minutes, show a warning.
                    vueApp.showNoUpdAlert = false; clearInterval(vueApp.hTimer); vueApp.hTimer = null;
                    vueApp.hTimer = vueApp.heatingUpdTimer()

                    vueApp.demand  = data.demand
                    // for convenience ...
                    vueApp.percentageDemand  = data.demand.PercentageDemand
                    vueApp.demandOnOffOutput = data.demand.DemandOnOffOutput
                    vueApp.isBoosted        = data.demand.isBoosted
                    //vueApp.qDemand = data.demand.DemandOnOffOutput === 'On' ? true : false
                    //vueApp.HeatingRelayState = data.demand.HeatingRelayState
                    //vueApp.IsSmartValvePreventingDemand = data.demand.IsSmartValvePreventingDemand

                    // Sorted array of home data
                    vueApp.homeData = data.homeDetails
                    // vvv NB: The below adds the _showDetails field TOO LATE for it to be
                    //         correctly responsive - now added at source
                    // Add _showDetails:false to all members of the array for the table display
                    //vueApp.homeData.map(item => {item._showDetails = false; return item;})

                    // TODO: Should we null/delete the newVal var? Or would that kill vueApp.homeData as well?
                    break

                // Individual switch update
                case 'COMMAND':
                    //console.debug('UIBUILDER:onChange:msg: COMMAND/SWITCHnn msg received ', newVal)
                    let sw = newVal.topic.replace('COMMAND/','')
                    vueApp.switches[sw].status = newVal.payload
                    break

                // Full switch update
                case 'SWITCHES':
                    vueApp.switches = newVal.payload
                    break

                // Individual device update
                case 'DEVICES':
                    //console.debug('UIBUILDER:onChange:msg: DEVICES/+ msg received ', newVal)
                    let dev = newVal.topic.replace('DEVICES/','')
                    vueApp.devices[dev].status = newVal.payload
                    break

                // Full devices update
                case 'DEVICESFULL':
                    vueApp.devices = newVal.payload
                    break

                // Don't process default
                default:
                    //ignore
            }
        }) // ---- End of uibuilder.onChange() watcher function ---- //

    } // --- End of mounted hook --- //

}) // --- End of app1 --- //

// EOF
