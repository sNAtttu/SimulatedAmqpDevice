// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

'use strict';

// The device connection string to authenticate the device with your IoT hub.
//
// NOTE:
// For simplicity, this sample sets the connection string in code.
// In a production environment, the recommended approach is to use
// an environment variable to make it available to your application
// or use an HSM or an x509 certificate.
// https://docs.microsoft.com/azure/iot-hub/iot-hub-devguide-security
//
// Using the Azure CLI:
// az iot hub device-identity show-connection-string --hub-name {YourIoTHubName} --device-id MyNodeDevice --output table
var connectionString = '';

// Using the Node.js Device SDK for IoT Hub:
//   https://github.com/Azure/azure-iot-sdk-node
// The sample connects to a device-specific MQTT endpoint on your IoT Hub.
const { AmqpWs } = require('azure-iot-device-amqp');
const { ExponentialBackOffWithJitter, RetryOperation } = require('azure-iot-common');
const appInsights = require("applicationinsights");
appInsights.setup("");
appInsights.start();

const Device = require('azure-iot-device');

const transient = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EADDRNOTAVAIL',
  'ENOTFOUND',
  'EPIPE'
];

const ErrorFilter = {
  // final
  ValidationError: false,
  ArgumentError: false,
  ArgumentNullError: false,
  ArgumentOutOfRangeError: false,
  DeviceNotFoundError: false,
  FormatError: false,
  UnauthorizedError: false,
  NotImplementedError: false,
  MessageTooLargeError: false,
  IotHubNotFoundError: false,
  JobNotFoundError: false,
  TooManyDevicesError: false,
  DeviceAlreadyExistsError: false,
  DeviceMessageLockLostError: false,
  InvalidEtagError: false,
  InvalidOperationError: false,
  PreconditionFailedError: false,
  BadDeviceResponseError: false,

  // retryable
  // Hub device client
  NotConnectedError: true,
  InternalServerError: true,
  ServiceUnavailableError: true,
  TimeoutError: true,
  ThrottlingError: true,
  DeviceTimeoutError: true,
  GatewayTimeoutError: true,
  DeviceMaximumQueueDepthExceededError: true,
  IoTHubSuspendedError: true,
  IotHubQuotaExceededError: true,
  // MQTT client
  MqttClientDisconnectedError: true,
  // storage
  StorageError: true, // depending on status??
  BlobSasError: true,
  BlobUploadNotificationError: true,
  // invalid object id. May be transient
  InvalidObjectError: true,
  InvalidModuleError: true
};



const authenticationProvider = Device.SharedAccessKeyAuthenticationProvider.fromConnectionString(connectionString);
const deviceClient = Device.Client.fromAuthenticationProvider(
  authenticationProvider,
  AmqpWs
);

class RetryPolicy extends ExponentialBackOffWithJitter {
  /**
   * @param {RetryPolicyOptions} options retry options
   * @param {function=} onRetry on retry listener
   */
  constructor(options, onRetry) {
    super(false, ErrorFilter);

    this.max = options.maximum;

    this.normalParameters.c = options.regular.initialInterval || 100;
    this.normalParameters.cMin = options.regular.minimumInterval || 100;
    this.normalParameters.cMax = options.regular.maximumInterval || 10000;

    this.throttledParameters.c = options.throttled.initialInterval || 5000;
    this.throttledParameters.cMin = options.throttled.minimumInterval || 10000;
    this.throttledParameters.cMax = options.throttled.maximumInterval || 60000;

    this.onRetry = onRetry;
  }

  shouldRetry(error) {
    // retry on
    const retry = RetryPolicy.shouldRetry(error);
    if (retry) {
      console.log(`${new Date()}: Encountered recoverable error ${error}`);
    } else {
      console.log(`${new Date()}: Encountered unrecoverable error ${error}`);
    }
    this.onRetry && this.onRetry(retry, error);
    return retry;
  }

  static shouldRetry(error) {
    return error.name
      ? ErrorFilter[error.name]
      : !error.code || transient.includes(error.code);
  }

  getRetryOperation(max) {
    return new RetryOperation(this, max || this.max);
  }
}

const retryOptions = {
  regular: {
    initialInterval: 100,
    minimumInterval: 100,
    maximumInterval: 10000
  },
  throttled: {
    initialInterval: 5000,
    minimumInterval: 10000,
    maximumInterval: 60000
  }
};

deviceClient.setRetryPolicy(new RetryPolicy(retryOptions, (retry, error) => {
  // emit disconnect event for this error
  if (error.name === 'NotConnectedError') {
    if (this._retryingToConnect) {
      return;
    }
    this._retryingToConnect = retry;
    console.log('Device client disconnected: ' + error);
    this.emit('disconnected');
    // check if connected after maxInterval. Not  pretty but there is no reporting from the device client in this case
    if (retry && (!this._transport._fsm.state === 'connected' ||
    this._transport._fsm.state === 'authenticated')) {
      this._connectionCheck = setInterval(() => {
        console.log(
          'Current transport state: ' + this._deviceClient._transport._fsm.state
        );
        // mqtt = connected, amqp = authenticated
        if (this._transport._fsm.state === 'connected' ||
        this._transport._fsm.state === 'authenticated') {
          clearInterval(this._connectionCheck);
          this._connectionCheck = null;
          this._retryingToConnect = false;
          this.emit('connected');
        }
      }, retryOptions.regular.maximumInterval);
    }
  }
}));

// Create a message and send it to the IoT hub every second
function sendOneTelemetry(){
  // Simulate telemetry.
  var temperature = 20 + (Math.random() * 15);
  var message = new Device.Message(JSON.stringify({
    temperature: temperature,
    timeStamp: new Date().toISOString(),
    humidity: 60 + (Math.random() * 20)
  }));

  // Add a custom application property to the message.
  // An IoT hub can filter on these properties without access to the message body.
  message.properties.add('temperatureAlert', (temperature > 30) ? 'true' : 'false');

  console.log('Sending message: ' + message.getData());
  // Send the message.
  deviceClient.sendEvent(message, function (err) {
    if (err) {
      console.error('send error: ' + err.toString());
    } else {
      console.log('message sent');
    }
  });
}

function sendAppInsightsData() {
  appInsights.defaultClient.trackMetric({name: "free memory", value: os.freemem()});
}


// sendOneTelemetry();
setInterval(sendOneTelemetry, 200);
setInterval(sendAppInsightsData, 1000);