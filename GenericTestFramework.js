/*
 * This is a mini test framework that provides some boilerplate code
 * to simplify tasks such as testing APIs that talk to remote parties
 */
var GenericTestFramework = {
	tests: null,
	inputs: null,
	logMessageJoin: 0,
	logMessage: "",

	configure: function(config, listJoin, logMessageJoin) {
		this.logMessageJoin = logMessageJoin;
		this.tests = config.tests;
		if (config.inputs instanceof Array && config.inputs.length) {
			this.inputs = config.inputs;
		} else {
			this.inputs = null;
		}
		var i, n = this.tests.length, t = [];
		for (i=0; i < n; i++) {
			t.push({ s1: this.tests[i].name	});
		}
		if (t.length) {
			CF.listAdd(listJoin, t);
		}
	},

	onTestButtonPressed: function(listIndex) {
		var testFunction = this.tests[listIndex].run;
		if (testFunction != null) {
			if (this.inputs == null) {
				try {
					testFunction({});
				}
				catch (e) {
					CF.log("Exception catched while running test function for " + this.tests[listIndex].name + ": " + e);
				}
			} else {
				var that = this;
				CF.getJoins(this.inputs, function(joins) {
					try {
						testFunction(joins);
					}
					catch (e) {
						CF.log("Exception catched while running test function for " + that.tests[listIndex].name + ": " + e);
					}
				});
			}
		}
	},

	onClearLog: function() {
		this.logMessage = "";
		CF.setJoin("s300", "");
	},

	log: function(message) {
		this.logMessage += message + "\n";
		CF.setJoin("s300", this.logMessage);
	}
};