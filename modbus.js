/* MODBUS TCP/IP device interface for CommandFusion iViewer
 //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

 AUTHORS:	Florent Pillet, CommandFusion
 VERSION:	v 0.1 - alpha

 /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 */

/**
 * Interface to MODBUS devices. This object only contains a method that returns
 * a {@link MODBUS_REMOTE} object allowing access to a single MODBUS TCP/IP device on
 * the network.
 *
 */
var MODBUS = {
	remotes: {},

	/**
	 * Obtain a {@link MODBUS_REMOTE} object to dialog with a MODBUS device over TCP/IP
	 * @param {String} systemName		name of the external TCP system in guiDesigner to use to send & receive MODBUS packets to the device
	 * @param {String} feedbackName		name of the feedback item to use in this TCP system to capture MODBUS response packets
	 * @return {MODBUS_REMOTE}			the MODBUS_REMOTE object you use to talk to the device using the MODBUS protocol
	 */
	getRemote: function(systemName, feedbackName) {
		var r = this.remotes[systemName];
		if (r == null) {
			r = this.remotes[systemName] = MODBUS_REMOTE(systemName, feedbackName);
		}
		return r;
	}
};

/**
 * A MODBUS_REMOTE object represents one remote MODBUS TCP/IP system,
 * to which we connect through an external system defined in guiDesigner
 *
 * Don't instantiate these directly. Rather, use {@link MODBUS.getRemote}() to obtain one.
 *
 * @param {String} sys	name of the external system defined in guiDesigner
 * @param {String} fb	name of the feedback item to watch that captures responses sent by MODBUS
 * @return {Object}		a new object for interaction with a MODBUS remote
 */
var MODBUS_REMOTE = function(sys,fb) {
	return {
		nextTransactionID: 1,
		transactions: { },
		watchedSystems: [],
		buffer: "",
		systemName: sys,
		feedbackName: fb,

		/**
		 * Send a request over to a MODBUS system. If a callback was specified, expect a response. The response
		 * will be processed asynchronously, and the callback called. You can use this function to send function codes
		 * that are not directly supported by other entry points in this object.
		 *
		 * @param {Number} slaveID		identification of a remote slave connected on a serial line or on other buses (0-255). Leave to 0 if you don't use it.
		 * @param {Number} functionCode	function code to send (0-255)
		 * @param {String} data			binary data to send as function payload
		 * @param {Function} callback	optional callback to receive the MODBUS response. Callback is of the form: callback(slaveID, functionCode, data)
		 * @param {Object} me			optional object to set as `this' when calling the callback function
		 * @return {Number}				a unique transaction ID. The same transaction ID will be passed back to the callback you specified when the response is received
		 */
		request: function(slaveID, functionCode, data, callback, me) {
			// assemble packet
			if (data == null) {
				data = "";
			} else if (data instanceof Array) {
				data = String.fromCharCode.apply(null, data);
			}
			var trans = this.nextTransactionID;
			var len = 2 + data.length;
			var pkt = String.fromCharCode.apply(null, [(trans >> 8) & 0xFF, trans & 0xFF, 0, 0, (len >> 8) & 0xFF, len & 0xFF, slaveID, functionCode]) + data;
			this.nextTransactionID = (this.nextTransactionID + 1) & 0xFFFF;

			// ensure we're watching answers from system
			if (callback instanceof Function) {
				if (this.watchedSystems.indexOf(this.systemName) === -1) {
					this.watchedSystems.push(this.systemName);
					var self = this;
					CF.watch(CF.FeedbackMatchedEvent, this.systemName, this.feedbackName, function(feedback,match) {
						self.buffer += match;
						self._processResponse();
					});
				}
				this.transactions["tr"+trans] = { cb: callback, me: me || null, slave: slaveID };
			}

			// send the packet
			CF.send(this.systemName, pkt, CF.BINARY);

			return trans;
		},

		/**
		 * Process responses from MODBUS. We go through buffered data to extract separate response packets
		 * and call the callback functions when appropriate
		 * @private
		 */
		_processResponse: function() {
			var buf = this.buffer;
			while (buf.length >= 8) {
				// decode the response
				var trans = (buf.charCodeAt(0) << 8) | buf.charCodeAt(1);
				var len = (buf.charCodeAt(4) << 8) | buf.charCodeAt(5);
				var unit = buf.charCodeAt(6);
				var functionCode = buf.charCodeAt(7);
				if (len > 0) {
					if (buf.length < (6 + len)) {
						return;		// data not complete yet, keep stacking packets
					}
					var data = buf.substr(8, len - 2);
					buf = this.buffer = buf.slice(6 + len);
				}

				// call the callback
				var trid = "tr" + trans;
				var callback = this.transactions[trid];
				if (callback != null && callback.slave === unit) {
					callback.cb.apply(callback.me, [ trans, unit, functionCode, data ]);
					delete this.transactions[trid];
				}
			}
		},

		/**
		 * Decode an array of bits from the payload returned by the MODBUS device.
		 * @param {Number} nBits		number of expected bits
		 * @param {String} data			server returns us a packed array of bits
		 * @return {Array}				an array of Boolean values
		 * @private
		 */
		_decodeBitsArray: function(nBits, data) {
			var n = data.charCodeAt(0), i = 1, c, bit = 8;
			var result = [];
			while (nBits-- > 0) {
				if (bit == 8) {
					if (--n < 0) {
						break;
					}
					c = data.charCodeAt(i++);
					bit = 0;
				}
				result.push((c & 1) != 0);
				c >>= 1;
				bit++;
			}
			return result;
		},

		/**
		 * Decode an array of int values returned by the MODBUS device
		 * @param data
		 * @private
		 */
		_decodeWordsArray: function(data) {
			var n = data.charCodeAt(0);
			var result = [];
			var i = 1;
			while (n > 0) {
				result.push((data.charCodeAt(i) << 8) | data.charCodeAt(i+1));
				i += 2;
				n -= 2;
			}
			return result;
		},

		//
		// Public API
		//

		/**
		 * FC-01
		 * <br>
		 * Read from 1 to 2000 contiguous status of coils in a remote device.
		 * The callback function receives the following parameters:
		 * <code>
		 * callback(slaveID, startAddress, errorCode, resultArray)
		 * </code>
		 * The `slaveID' and `startAddress' parameters are the same than the ones you passed in. `errorCode' is 0 if there
		 * was no error, otherwise it's an error code as specified in the MODBUS documentation.
		 *
		 * The results array holds one Boolean value for each coil that has been read. First item in the array
		 * is the coil at startAddress.
		 *
		 * @param {Number} slaveID		identification of a remote slave connected on a serial line or on other buses (0-255). Leave to 0 if you don't use it.
		 * @param {Number} startAddress	first coil to read. Addresses start are in the range 0-65535
		 * @param {Number} quantity		number of coils to read, in the range 1-2000
		 * @param {Function} callback	your callback function, see function prototype above
		 * @param {Object} me			optional the object to set as `this' when calling your callback function. Omit it or pass null if you don't need it.
		 */
		readCoils: function(slaveID, startAddress, quantity, callback, me) {
			var payload = String.fromCharCode.apply(null, [ (startAddress >> 8) & 0xFF, startAddress & 0xFF, (quantity >> 8) & 0xFF, quantity & 0xFF ]);
			this.request(slaveID, 0x01, payload, function(trans, unit, fc, data) {
				if (fc == 0x81) {	// error
					callback.apply(me, [ slaveID, startAddress, data.charCodeAt(0), [] ]);
				} else {
					callback.apply(me, [ slaveID, startAddress, 0, this._decodeBitsArray(quantity, data) ]);
				}
			}, this);
		},

		/**
		 * FC-02
		 * <br>
		 * Read the contents of a contiguous block of discrete inputs in a remote device.
		 *
		 * callback(slaveID, startAddress, errorCode, resultArray)
		 *
		 * The `slaveID' and `startAddress' parameters are the same than the ones you passed in. `errorCode' is 0 if there
		 * was no error, otherwise it's an error code as specified in the MODBUS documentation.
		 *
		 * The results array holds one number for each discrete input that has been read. First item in the array
		 * is the discrete input at startAddress.
		 *
		 * @param {Number} slaveID		identification of a remote slave connected on a serial line or on other buses (0-255). Leave to 0 if you don't use it.
		 * @param {Number} startAddress	first discrete input to read. Addresses start are in the range 0-65535
		 * @param {Number} quantity		number of inputs to read. Valid quantities are in the range 1-2000
		 * @param {Function} callback	your callback function, see function prototype above
		 * @param {Object} me			optional the object to set as `this' when calling your callback function. Omit it or pass null if you don't need it.
		 */
		readDiscreteInputs: function(slaveID, startAddress, quantity, callback, me) {
			var payload = String.fromCharCode.apply(null, [ (startAddress >> 8) & 0xFF, startAddress & 0xFF, (quantity >> 8) & 0xFF, quantity & 0xFF ]);
			this.request(slaveID, 0x02, payload, function(trans, unit, fc, data) {
				if (fc == 0x82) {
					// error
					callback.apply(me, [ unit, startAddress, data.charCodeAt(0), [] ]);
				} else {
					callback.apply(me, [ slaveID, startAddress, 0, this._decodeBitsArray(quantity, data) ]);
				}
			}, this);
		},

		/**
		 * FC-03
		 * Read the contents of a contiguous block of holding registers in a remote device.
		 *
		 * callback(slaveID, startAddress, errorCode, resultArray)
		 *
		 * The `slaveID' and `startAddress' parameters are the same than the ones you passed in. `errorCode' is 0 if there
		 * was no error, otherwise it's an error code as specified in the MODBUS documentation.
		 *
		 * The results array holds one number for each register that has been read. First item in the array
		 * is the register at startAddress.
		 *
		 * @param {Number} slaveID		identification of a remote slave connected on a serial line or on other buses (0-255). Leave to 0 if you don't use it.
		 * @param {Number} startAddress	first holding register to read. Addresses start are in the range 0-65535
		 * @param {Number} quantity		number of holding registers to read. Valid quantities are in the range 1-125
		 * @param {Function} callback	your callback function, see function prototype above
		 * @param {Object} me			optional the object to set as `this' when calling your callback function. Omit it or pass null if you don't need it.
		 */
		readHoldingRegisters: function(slaveID, startAddress, quantity, callback, me) {
			var payload = String.fromCharCode.apply(null, [ (startAddress >> 8) & 0xFF, startAddress & 0xFF, (quantity >> 8) & 0xFF, quantity & 0xFF ]);
			this.request(slaveID, 0x03, payload, function(trans, unit, fc, data) {
				if (fc == 0x83) {
					callback.apply(me, [ unit, startAddress, data.charCodeAt(0), [] ]);
				} else {
					callback.apply(me, [ unit, startAddress, 0, this._decodeWordsArray(data) ]);
				}
			}, this);
		},

		/**
		 * FC-04
		 * Read the contents of a contiguous block of input registers in a remote device.
		 *
		 * callback(slaveID, startAddress, errorCode, resultArray)
		 *
		 * The `slaveID' and `startAddress' parameters are the same than the ones you passed in. `errorCode' is 0 if there
		 * was no error, otherwise it's an error code as specified in the MODBUS documentation.
		 *
		 * The results array holds one number for each register that has been read. First item in the array
		 * is the register at startAddress.
		 *
		 * @param {Number} slaveID		identification of a remote slave connected on a serial line or on other buses (0-255). Leave to 0 if you don't use it.
		 * @param {Number} startAddress	first input register to read. Addresses start are in the range 0-65535
		 * @param {Number} quantity		number of input registers to read. Valid quantities are in the range 1-125
		 * @param {Function} callback	your callback function, see function prototype above
		 * @param {Object} me			optional the object to set as `this' when calling your callback function. Omit it or pass null if you don't need it.
		 */
		readInputRegisters: function(slaveID, startAddress, quantity, callback, me) {
			var payload = String.fromCharCode.apply(null, [ (startAddress >> 8) & 0xFF, startAddress & 0xFF, (quantity >> 8) & 0xFF, quantity & 0xFF ]);
			this.request(slaveID, 0x04, payload, function(trans, unit, fc, data) {
				if (fc == 0x84) {
					callback.apply(me, [ unit, startAddress, data.charCodeAt(0), [] ]);
				} else {
					callback.apply(me, [ unit, startAddress, 0, this._decodeWordsArray(data) ]);
				}
			}, this);
		},

		/**
		 * FC-05
		 * Write a single output to either ON or OFF in a remote device.
		 * Your callback function is optional (you can omit it). If you
		 * pass one, you will be called with the MODBUS response that confirms the write or gives
		 * an error code:
		 *
		 * callback(slaveID, output, errorCode, value)
		 *
		 * Where slaveID is the slave ID, register and value are the values returned by MODBUS (if there was no error,
		 * they should be the same as the ones you passed in). errorCode
		 * will be 0 if there was not error, or another error code according to the documentation.
		 *
		 * @param {Number} slaveID			identification of a remote slave connected on a serial line or on other buses (0-255). Leave to 0 if you don't use it.
		 * @param {Number} outputAddress	number of the register to write, 0x0000 to 0xFFFF (0 to 65535)
		 * @param {Number} outputValue		value to write in the register
		 * @param {Function} callback		your callback function, see function prototype above
		 * @param {Object} me				optional the object to set as `this' when calling your callback function. Omit it or pass null if you don't need it.
		 */
		writeSingleCoil: function(slaveID, outputAddress, outputValue, callback, me) {
			var payload = String.fromCharCode.apply(null, [ (outputAddress >> 8) & 0xFF, outputAddress & 0xFF, (outputValue >> 8) & 0xFF, outputValue & 0xFF ]);
			this.request(slaveID, 0x06, payload, function(trans, unit, fc, data) {
				if (fc === 0x86) {
					// error
					callback.apply(me, [ unit, outputAddress, data.charCodeAt(0), outputValue ]);
				} else {
					// decode returned values
					callback.apply(me, [ unit, (data.charCodeAt(0) << 8) | data.charCodeAt(1), 0, (data.charCodeAt(2) << 8) | data.charCodeAt(3) ]);
				}
			}, this);
		},

		/**
		 * FC-06
		 * Write a single register. Your callback function is optional (you can omit it). If you
		 * pass one, you will be called with the MODBUS response that confirms the write or gives
		 * an error code:
		 *
		 * callback(slaveID, register, errorCode, value)
		 *
		 * Where slaveID is the slave ID, register and value are the values returned by MODBUS (if there was no error,
		 * they should be the same as the ones you passed in). errorCode
		 * will be 0 if there was not error, or another error code according to the documentation.
		 *
		 * @param {Number} slaveID		identification of a remote slave connected on a serial line or on other buses (0-255). Leave to 0 if you don't use it.
		 * @param {Number} register		number of the register to write, 0x0000 to 0xFFFF (0 to 65535)
		 * @param {Number} value		value to write in the register
		 * @param {Function} callback	your callback function, see function prototype above
		 * @param {Object} me			optional the object to set as `this' when calling your callback function. Omit it or pass null if you don't need it.
		 */
		writeSingleRegister: function(slaveID, register, value, callback, me) {
			var payload = String.fromCharCode.apply(null, [ (register >> 8) & 0xFF, register & 0xFF, (value >> 8) & 0xFF, value & 0xFF ]);
			this.request(slaveID, 0x06, payload, function(trans, unit, fc, data) {
				if (fc === 0x86) {
				 	// error
					callback.apply(me, [ unit, register, data.charCodeAt(0), value ]);
				} else {
					// decode returned values
					callback.apply(me, [ unit, (data.charCodeAt(0) << 8) | data.charCodeAt(1), 0, (data.charCodeAt(2) << 8) | data.charCodeAt(3) ]);
				}
			}, this);
		},

		/**
		 * FC-0F
		 * Force each coil in a sequence of coils to either ON or OFF in a remote device.
		 * Your callback function is optional (you can omit it). If you pass one,
		 * you will be called with the MODBUS response that confirms the write or gives
		 * an error code:
		 *
		 * callback(slaveID, startAddress, errorCode, numberOfCoils)
		 *
		 *
		 * @param {Number} slaveID		identification of a remote slave connected on a serial line or on other buses (0-255). Leave to 0 if you don't use it.
		 * @param startAddress			first referenced coil. Positions start at 0
		 * @param values				an array of Boolean values, one for each coil. The number of coils to write is directly derived from the length of the array
		 * @param {Function} callback	your callback function, see function prototype above
		 * @param {Object} me			optional the object to set as `this' when calling your callback function. Omit it or pass null if you don't need it.
		 */
		writeMultipleCoils: function(slaveID, startAddress, values, callback, me) {
			// assemble the bits according to specification
			var i, num = values.length, bytes = num / 8 + (((num % 8) !== 0) ? 1 : 0);
			var a = [ (startAddress >> 8) & 0xFF, startAddress & 0xFF, (num >> 8) & 0xFF, num & 0xFF, bytes ];
			var c = 0, j = 0, k = 1;
			for (i = 0; i < num; i++) {
				if (values[i]) {
					c |= k;
				}
				k <<= 1;
				if (++j === 8) {
					a.push(c);
					j = 0;
					k = 1;
				}
			}
			if (j !== 0) {
				// write the last byte
				a.push(c);
			}
			this.request(slaveID, 0x0F, String.fromCharCode.apply(null, a), function(trans, unit, fc, data) {
				if (fc === 0x8F) {
					callback.apply(me, [ unit, register, data.charCodeAt(0), value ]);
				} else {
					callback.apply(me, [ unit, (data.charCodeAt(0) << 8) | data.charCodeAt(1), 0, (data.charCodeAt(2) << 8) | data.charCodeAt(3) ]);
				}
			}, this);
		}
	}
};

CF.modules.push({
	name:"MODBUS",			// the name of this module
	object:MODBUS,			// the `this' object for the setup function
	version:"v0.2"			// the version of this module
});
