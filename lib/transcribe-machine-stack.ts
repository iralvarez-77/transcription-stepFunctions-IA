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
          'MediaFileUri': `{% "s3://" & $states.input.bucket.name & "/" & $states.input.object.key %}`,
        },
        'TranscriptionJobName': '{% $states.context.Execution.Name %}',
        'LanguageCode': 'en-US',
        'OutputBucketName': transcribeBucketS3.bucketName,
        'OutputKey': `{% "transcribed/" & $states.input.object.key & ".txt" %}`
      },
      assign: {
        'archivoOriginal': '{% $states.input.object.key %}' // Es completamente normal y correcto que no veas la variable en el input del estado Wait.En JSONata, las variables creadas con assign no viajan mezcladas dentro del payload del JSON principal (input u output). En su lugar, viajan en un contenedor de memoria paralelo del sistema que AWS Step Functions llama Variables de la Máquina de Estados (por eso en la salida de Transcribe Text te apareció bajo el campo separado llamado "assignedVariables"). Almacenar variables con assign es como guardar un valor en la memoria RAM del flujo. El valor de $archivoOriginal se mantendrá "vivo" de forma invisible durante toda la ejecución de la máquina, atravesando el Wait, loops o cualquier otro estado.
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

    //Estado 5: 
    const getTranscribedTextFromS3 = new tasks.CallAwsService(this, 'Get Transcribed File', {
      service: 's3',
      action: 'getObject',
      queryLanguage: sfn.QueryLanguage.JSONATA,
      parameters: {
        'Bucket': transcribeBucketS3.bucketName,
        'Key': `{% "transcribed/" & $archivoOriginal & ".txt" %}` // `{% "transcribed/" & $states.input.object.key & ".txt" %}`.El problema por el cual tu propiedad "Key" se genera vacía como "transcribed/.txt" es porque en el momento en que se ejecuta el paso 'Get Transcribed File', el objeto $states.input ya no contiene la propiedad object.key.En AWS Step Functions, cada paso que se ejecuta sobrescribe el JSON de entrada del siguiente paso. Como tu paso anterior fue 'Transcribe Text' (Amazon Transcribe), la salida de ese servicio es un JSON con los datos del Job de transcripción, destruyendo tu entrada original de S3 donde venía "mi-video.MP4".Para solucionar esto en JSONata, debes capturar el valor de la clave del archivo al inicio del flujo y almacenarlo en una variable de asignación (assign) para poder usarlo en pasos posteriores sin importar lo que respondan los servicios intermedios.
      },
      iamResources: [transcribeBucketS3.arnForObjects('*')],
    });

    // Estado 6: Clean Transcribed Text
    const cleanTranscribedText = new sfn.Pass(this, 'Clean Transcribed Text', {
      outputs: {
        'cleaned': {
          'Text': '{% $parse($states.input.Body).results.transcripts.transcript %}' // el objeto Body viene codificado como una cadena de texto (String) dentro de Step Functions, Cuando el SDK de S3 ejecuta getObject, devuelve el archivo como un string plano. Para poder navegar dentro de sus propiedades (results.transcripts), es obligatorio parsearlo a JSON primero.
        }
      }
    });

    // Estado 7: Translate Text
    const translateText = new tasks.CallAwsService(this, 'Translate Text', {
      service: 'translate',
      action: 'translateText',
      queryLanguage: sfn.QueryLanguage.JSONATA,
      parameters: {
        'Text': '{% $states.input.cleaned.Text %}',
        'SourceLanguageCode': 'en',
        'TargetLanguageCode': 'es',
      },
      iamResources: ['*'],
    });

    // estado 8: Add Basic Prompt to the Output
    const addBasicPrompt = new sfn.Pass(this, 'Add basic prompt to the output', {
      queryLanguage: sfn.QueryLanguage.JSONATA,
      outputs: {
        // Arrastramos todo lo que venía en el input original (como tu cleaned.Text y FileName)
        'cleaned': '{% $states.input.TranslatedText %}',
        // Esto reemplaza al ResultPath: $.prompt
        'prompt': {
          'basicPrompt': 'Given the transcript provided at the end of the prompt, return a summary of 160 characters of the transcript. Keep the original language of the transcript. If the transcript is provided in spanish, return the summary in spanish. Here is the transcript: '
        }
      }
    });
     // Estado 9: Combine prompts
    // const combinePrompts = new sfn.Pass(this, 'Combine prompts', {
    //   queryLanguage: sfn.QueryLanguage.JSONATA,
    //   outputs: {
    //     // Seguimos arrastrando los datos base para que no se pierdan
    //     'cleaned': '{% $states.input.cleaned %}',
    //     'prompt': '{% $states.input.prompt %}',
    //     // Esto reemplaza a ResultPath: $.completedPrompt y States.Format
    //     'completedPrompt': {
    //       // Nota: Ajusté $.transcriptedText.TranslatedText al formato JSONata que definiste antes ($states.input.cleaned.Text)
    //       'prompt': '{% $states.input.prompt.basicPrompt & " " & $states.input.cleaned.Text %}'
    //     }
    //   }
    // });
    // Estado 10: Create S3 result URI
    // const createS3ResultUri = new sfn.Pass(this, 'Create S3 result URI', {
    //   queryLanguage: sfn.QueryLanguage.JSONATA,
    //   outputs: {
    //     // Arrastramos el acumulado de los pasos anteriores
    //     'cleaned': '{% $states.input.cleaned %}',
    //     'prompt': '{% $states.input.prompt %}',
    //     'completedPrompt': '{% $states.input.completedPrompt %}',
    //     // Esto reemplaza a ResultPath: $.resultURI y States.Format
    //     'resultURI': {
    //       // Usamos la variable FileName que limpiamos dinámicamente en el paso 'Clean Transcribed Text'
    //       'uri': `{% "https://s3.us-east-1.amazonaws.com/${transcribeBucketS3.bucketName}/results/" & $states.input.cleaned.FileName %}`
    //     }
    //   }
    // });

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
        getTranscribedTextFromS3
          .next(cleanTranscribedText)
          .next(translateText)
          .next(addBasicPrompt)
          //.next(combinePrompts)
          //.next(createS3ResultUri)
          .next(succeedState)
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
        'translate:TranslateText'
      ],
      resources: ['*'],
    }));

    s3PutEventRule.addTarget(new targets.SfnStateMachine(transcribeMachine, {
      input: events.RuleTargetInput.fromEventPath('$.detail'),
    }));

  }
}
