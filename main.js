var testDevice = null;
var TESTS = {
	// A list of input fields whose contents are gathered before running each test
	inputs: [ "s10", "s11", "s12" ],

	// A list of test, one object per test
	tests: [
		{
			name: "FC-01: Read Coils",
			run: function(inputs) {
				GenericTestFramework.log("Reading coils...");
				var start = parseInt(inputs.s10.value, 10);
				var qty = parseInt(inputs.s11.value, 10);
				testDevice.readCoils(0, start, qty, function(unit, startAddress, errorCode, result) {
					GenericTestFramework.log("readCoils returned: unit="+unit+", startAddress="+startAddress+", errorCode="+errorCode+", result="+result);
				});
			}
		},
		{
			name: "FC-03: Read Holding Registers",
			run: function(inputs) {
				GenericTestFramework.log("Reading holding registers...");
				var start = parseInt(inputs.s10.value, 10);
				var qty = parseInt(inputs.s11.value, 10);
				testDevice.readHoldingRegisters(0, start, qty, function(unit, startAddress, errorCode, result) {
					GenericTestFramework.log("readHoldingRegisters returned: unit="+unit+", startAddress="+startAddress+", errorCode="+errorCode+", result="+result);
				});
			}
		},
		{
			name: "FC-06: Write Single Register",
			run: function(inputs) {
				GenericTestFramework.log("Writing single register...");
				var reg = parseInt(inputs.s10.value, 10);
				var val = parseInt(inputs.s12.value, 10);
				testDevice.writeSingleRegister(0, reg, val, function(unit, register, errorCode, result) {
					GenericTestFramework.log("writeSingleRegister returned: unit="+unit+", register="+register+", errorCode="+errorCode+", value="+result);
				});
			}
		}
	]
};

CF.userMain = function() {
	// Read the saved modbus IP address and port and update the fields
	CF.getJoin(CF.GlobalTokensJoin, function(join,value,tokens) {
		var modbusIP = tokens["MODBUS_IP"] || "192.168.0.1";
		var modbusPort = tokens["MODBUS_PORT"] || "503";
		CF.setJoin("s200", modbusIP);
		CF.setJoin("s201", modbusPort);

		testDevice = MODBUS.getRemote("MODBUS", "Feedback");
		GenericTestFramework.configure(TESTS, "l1", "s300");
	});
};

function onUpdateTargetSystem() {
	CF.getJoins(["s200", "s201", CF.GlobalTokensJoin], function(joins) {
		// read updated
		var modbusIP = joins.s200.value;
		var modpusPort = joins.s201.value;
		var change = false;
		if (modbusIP != joins[CF.GlobalTokensJoin].tokens["MODBUS_IP"]) {
			CF.setToken(CF.GlobalTokensJoin, "MODBUS_IP", modbusIP);
			change = true;
		}
		if (modbusPort != joins[CF.GlobalTokensJoin].tokens["MODBUS_PORT"]) {
			CF.setToken(CF.GlobalTokensJoin, "MODBUS_PORT", modbusPort);
			change = true;
		}
		if (change) {
			CF.setSystemProperties("MODBUS", {
				address: modbusIP,
				port: parseInt(modbusPort, 10)
			});
		}
	});
}
