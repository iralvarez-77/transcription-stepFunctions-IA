/** @format */

import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as lambda from "aws-cdk-lib/aws-lambda";

interface MyFirstMachineStackProps extends cdk.StackProps {
  lambdaFunction: lambda.IFunction;
}

export class MyFirstMachineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MyFirstMachineStackProps) {
    super(scope, id, props);

    const lambdaInvokeTask = tasks.LambdaInvoke.jsonata(this, "Lambda Invoke", {
      lambdaFunction: props.lambdaFunction,
      payload: sfn.TaskInput.fromObject({
        Payload: "{% $states.input %}",
      }),
      outputs: {
        Output: "{% $states.result.Payload %}",
      },
      retryOnServiceExceptions: false,
    });

    lambdaInvokeTask.addRetry({
      errors: [
        "Lambda.ServiceException",
        "Lambda.AWSLambdaException",
        "Lambda.SdkClientException",
        "Lambda.TooManyRequestsException",
      ],
      interval: cdk.Duration.seconds(1),
      maxAttempts: 3,
      backoffRate: 2,
      jitterStrategy: sfn.JitterType.FULL,
    });

    new sfn.StateMachine(this, "MyStateMachine", {
      comment: "A description of my state machine",
      definitionBody: sfn.DefinitionBody.fromChainable(lambdaInvokeTask),
      queryLanguage: sfn.QueryLanguage.JSONATA,
    });
  }
}
