#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { HelloCdkStack } from '../lib/hello-cdk-stack';
import { MyFirstMachineStack } from '../lib/my-first-machine-stack';

const app = new cdk.App();
const helloStack = new HelloCdkStack(app, 'HelloCdkStack', {})

new MyFirstMachineStack(app, 'MyFirstMachineStack', {
  lambdaFunction: helloStack.saveHelloFunction, // Pasamos la función Lambda desde HelloCdkStack
})

