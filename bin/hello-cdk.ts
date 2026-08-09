#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { HelloCdkStack } from '../lib/hello-cdk-stack';
//import { MyFirstMachineStack } from '../lib/my-first-machine-stack';
import { enableAslAutoGeneration } from '../utils/asl-generator';
import { TranscribeMachineStack } from '../lib/transcribe-machine-stack';

const app = new cdk.App();
const helloStack = new HelloCdkStack(app, 'HelloCdkStack', {})

// const machineStack =  new MyFirstMachineStack(app, 'MyFirstMachineStack', {
//   lambdaFunction: helloStack.saveHelloFunction, // Pasamos la función Lambda desde HelloCdkStack
// })

const transcribeMachineStack = new TranscribeMachineStack(app, 'TranscribeMachineStack', {
  inputBucketName: 'transcribe-machine-bucket-iiam', // Nombre del bucket de entrada
});

enableAslAutoGeneration(transcribeMachineStack, 'template');