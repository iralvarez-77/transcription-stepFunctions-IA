import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';

export class TranscribeStateMachineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Variable que representa tu bucket de salida (reemplaza con tu referencia real)
    const transcriptionBucketName = 'tu-bucket-de-transcripcion-aqui';

    // 1. Definición del Estado: Transcribe Text
    const transcribeText = new tasks.CallAwsService(this, 'Transcribe Text', {
      service: 'transcribe',
      action: 'startTranscriptionJob',
      parameters: {
        'Media': {
          'MediaFileUri.$': "States.Format('s3://{}/{}', $.detail.bucket.name, $.detail.object.key)"
        },
        'TranscriptionJobName.$': '$$.Execution.Name',
        'LanguageCode': 'en-US',
        'OutputBucketName': transcriptionBucketName,
        'OutputKey.$': "States.Format('{}.txt', $.detail.object.key)"
      },
      iamResources: ['*'], // AWS Transcribe requiere esto para manejar los jobs a nivel de cuenta
      additionalIamStatements: [
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: ['*'], // Ajusta a los ARNs específicos de tus buckets por seguridad
        })
      ]
    });

    // 2. Definición del Estado: Wait For Transcribe
    const waitForTranscribe = new sfn.Wait(this, 'Wait For Transcribe', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(60)),
    });

    // 3. Definición del Estado: Check Transcription Job Status
    const checkTranscriptionJobStatus = new tasks.CallAwsService(this, 'Check Transcription Job Status', {
      service: 'transcribe',
      action: 'getTranscriptionJob',
      parameters: {
        'TranscriptionJobName.$': '$$.Execution.Name',
      },
      iamResources: ['*'],
    });

    // 4. Definición de los Estados Finales (Succeed y Fail)
    const succeedState = new sfn.Succeed(this, 'Succeed');
    const failedState = new sfn.Fail(this, 'Failed', {
      cause: 'Transcription Job failed',
      error: 'FAILED',
    });

    // 5. Definición del Estado de Selección: Transcription Job Status Successful
    const transcriptionJobStatusSuccessful = new sfn.Choice(this, 'Transcription Job Status Successful')
      .when(
        sfn.Condition.stringEquals('$.TranscriptionJob.TranscriptionJobStatus', 'COMPLETED'),
        succeedState
      )
      .when(
        sfn.Condition.stringEquals('$.TranscriptionJob.TranscriptionJobStatus', 'FAILED'),
        failedState
      )
      .otherwise(waitForTranscribe); // Reintenta esperando si sigue en IN_PROGRESS

    // 6. Encadentamiento de la lógica del flujo (Workflow)
    const definition = transcribeText
      .next(waitForTranscribe)
      .next(checkTranscriptionJobStatus)
      .next(transcriptionJobStatusSuccessful);

    // 7. Creación de la Máquina de Estados final
    new sfn.StateMachine(this, 'TranscribeStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(1), // Opcional: tiempo límite global
    });
  }
}
