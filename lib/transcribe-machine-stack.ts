import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

interface TranscribeMachineStackProps extends cdk.StackProps {
  inputBucketName?: string;
}

export class TranscribeMachineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: TranscribeMachineStackProps) {
    super(scope, id, props);

    const transcribeBucketS3 = new s3.Bucket(this, 'TranscribeBucketS3', {
      bucketName: props?.inputBucketName || undefined,
      eventBridgeEnabled: true, // Habilita eventos de EventBridge para el bucket
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const s3PutEventRule = new events.Rule(this, 'S3PutEventRule', {
      //eventBus: myCustomBus, En el código de AWS CDK, si no especificas la propiedad eventBus, CDK asume automáticamente que la regla se debe registrar en el bus default.
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'], // Se activa al subir/crear objetos
        detail: {
          bucket: {
            name: [transcribeBucketS3.bucketName], // Filtra por tu bucket
          },
          object: {
            key: [{ suffix: '.MP4' }],
          },
        },
      },
    });

    const transcribeText = new tasks.CallAwsService(this, 'Transcribe Text', {
      service: 'transcribe',
      action: 'startTranscriptionJob',
      queryLanguage: sfn.QueryLanguage.JSONATA,
      parameters: {
        'Media': {
          'MediaFileUri': `{% "s3://" & $states.input.detail.bucket.name & "/" & $states.input.detail.object.key %}`
        },
        'TranscriptionJobName': '{% $states.context.Execution.Name %}',
        'LanguageCode': 'en-US',
        'OutputBucketName': transcribeBucketS3.bucketName,
        'OutputKey': `{% "transcribed/" & $states.input.detail.object.key & ".txt" %}`
      },
      iamResources: ['*'],
    });
    
    // Estado 2: Wait For Transcribe
    const waitForTranscribe = new sfn.Wait(this, 'Wait For Transcribe', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(60)),
    });

    // Estado 3: Check Transcription Job Status
    const checkTranscriptionJobStatus = new tasks.CallAwsService(this, 'Check Transcription Job Status', {
      service: 'transcribe',
      action: 'getTranscriptionJob',
      queryLanguage: sfn.QueryLanguage.JSONATA,
      parameters: {
        'TranscriptionJobName': '{% $states.context.Execution.Name %}',
      },
      iamResources: ['*'],
    });

    // Estados Finales
    const succeedState = new sfn.Succeed(this, 'Succeed');
    const failedState = new sfn.Fail(this, 'Failed', {
      cause: 'Transcription Job failed',
      error: 'FAILED',
    });

    // Estado 4: Choice (Formato JSONata usando sfn.Condition.jsonata)
    const transcriptionJobStatusSuccessful = new sfn.Choice(this, 'Transcription Job Status Successful')
      .when(
        sfn.Condition.jsonata('{% $states.input.TranscriptionJob.TranscriptionJobStatus = "COMPLETED" %}'),
        succeedState
      )
      .when(
        sfn.Condition.jsonata('{% $states.input.TranscriptionJob.TranscriptionJobStatus = "FAILED" %}'),
        failedState
      )
      .otherwise(waitForTranscribe);

    const definition = transcribeText
      .next(waitForTranscribe)
      .next(checkTranscriptionJobStatus)
      .next(transcriptionJobStatusSuccessful);

    const transcribeMachine = new sfn.StateMachine(this, 'TranscribeMachine', {
      comment: "application that can transcribe a video",
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      queryLanguage: sfn.QueryLanguage.JSONATA,
    });

    //otorga permisos de lectura en el bucket de S3 a la máquina de estados y permisos para iniciar y obtener trabajos de transcripción
    transcribeBucketS3.grantReadWrite(transcribeMachine);
    transcribeMachine.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:StartTranscriptionJob',
        'transcribe:GetTranscriptionJob',
      ],
      resources: ['*'],
    }));

    s3PutEventRule.addTarget(new targets.SfnStateMachine(transcribeMachine, {
      input: events.RuleTargetInput.fromEventPath('$.detail'),
    }));

  }
}
