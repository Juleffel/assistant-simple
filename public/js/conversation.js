// The ConversationPanel module is designed to handle
// all display and behaviors of the conversation column of the app.
/* eslint no-unused-vars: "off" */
/* global Api: true, Common: true*/

var ConversationPanel = (function () {
  var settings = {
    selectors: {
      chatBox: '#scrollingChat',
      fromUser: '.from-user',
      fromWatson: '.from-watson',
      latest: '.latest'
    },
    authorTypes: {
      user: 'user',
      watson: 'watson'
    },
    voices: {
      listen: 'en-US_BroadbandModel',
      say: 'en-US_MichaelVoice',
    }
  };
  var watsonResponses = [];
  var processingWatsonResponses = false;

  var stream = null;
  var sayList = [];
  var sayEnabled = false;
  var isSaying = false;
  var isListening = false;
  var wasListening = false;
  var translateInput = false;
  var translateOutput = false;
  var assistantLang = 'en';
  var listenVoiceSelect = document.querySelector('#listen-voice');
  var listeningButton = document.querySelector('#listening');
  var sayVoiceSelect = document.querySelector('#say-voice');
  var sayingButton = document.querySelector('#saying');
  var $voiceOutputDiv = $('.output-voice');
  var $voiceOutputConfidence = $('#output-voice-confidence');
  var $voiceOutputButtonOk = $('#voice-ok');
  var $voiceOutputButtonKo = $('#voice-ko');
  var $voiceOutputButtonSent = $('#voice-sent');

  var tokens = {
    tts: "",
    stt: "",
  }

  // Publicly accessible methods defined
  return {
    init,
    inputKeyDown,
    sendMessage,
  };

  // Initialize the module
  function init(workspaceId, lang) {
    if (workspaceId) {
      Api.setWorkspace(workspaceId);
    }
    if (lang) {
      assistantLang = lang;
    }
    chatUpdateSetup();
    Api.sendRequest('', null);
    fetchToken('/api/text-to-speech/token', 'tts');
    sayingButton.disabled = false;
    fetchToken('/api/speech-to-text/token', 'stt');
    listeningButton.disabled = false;
    setListenVoice();
    setSayVoice();
    listenVoiceSelect.onchange = setListenVoice;
    listeningButton.onclick = startListeningConfidence;
    sayVoiceSelect.onchange = setSayVoice;
    sayingButton.onclick = startSaying;
    setupInputBox();
  }

  function fetchToken(url, tokenName) {
    fetch(url)
      .then(function (response) {
        return response.text();
      }).then(function (token) {
        tokens[tokenName] = token;
      }).catch(function (error) {
        console.error(error);
      });
  }
  // Set up callbacks on payload setters in Api module
  // This causes the displayMessage function to be called when messages are sent / received
  function chatUpdateSetup() {
    var currentRequestPayloadSetter = Api.setRequestPayload;
    Api.setRequestPayload = function (newPayloadStr) {
      currentRequestPayloadSetter.call(Api, newPayloadStr);
      displayMessage(JSON.parse(newPayloadStr), settings.authorTypes.user);
    };

    var currentResponsePayloadSetter = Api.setResponsePayload;
    Api.setResponsePayload = function (newPayloadStr) {
      currentResponsePayloadSetter.call(Api, newPayloadStr);
      displayMessage(JSON.parse(newPayloadStr), settings.authorTypes.watson);
    };
  }

  // Set up the input box to underline text as it is typed
  // This is done by creating a hidden dummy version of the input box that
  // is used to determine what the width of the input text should be.
  // This value is then used to set the new width of the visible input box.
  function setupInputBox() {
    var input = document.getElementById('textInput');
    var dummy = document.getElementById('textInputDummy');
    var minFontSize = 14;
    var maxFontSize = 16;
    var minPadding = 4;
    var maxPadding = 6;

    // If no dummy input box exists, create one
    if (dummy === null) {
      var dummyJson = {
        'tagName': 'div',
        'attributes': [{
          'name': 'id',
          'value': 'textInputDummy'
        }]
      };

      dummy = Common.buildDomElement(dummyJson);
      document.body.appendChild(dummy);
    }

    function adjustInput() {
      if (input.value === '') {
        // If the input box is empty, remove the underline
        input.classList.remove('underline');
        input.setAttribute('style', 'width:' + '100%');
        input.style.width = '100%';
      } else {
        // otherwise, adjust the dummy text to match, and then set the width of
        // the visible input box to match it (thus extending the underline)
        input.classList.add('underline');
        var txtNode = document.createTextNode(input.value);
        ['font-size', 'font-style', 'font-weight', 'font-family', 'line-height',
          'text-transform', 'letter-spacing'
        ].forEach(function (index) {
          dummy.style[index] = window.getComputedStyle(input, null).getPropertyValue(index);
        });
        dummy.textContent = txtNode.textContent;

        var padding = 0;
        var htmlElem = document.getElementsByTagName('html')[0];
        var currentFontSize = parseInt(window.getComputedStyle(htmlElem, null).getPropertyValue('font-size'), 10);
        if (currentFontSize) {
          padding = Math.floor((currentFontSize - minFontSize) / (maxFontSize - minFontSize) *
            (maxPadding - minPadding) + minPadding);
        } else {
          padding = maxPadding;
        }

        var widthValue = (dummy.offsetWidth + padding) + 'px';
        input.setAttribute('style', 'width:' + widthValue);
        input.style.width = widthValue;
      }
    }

    // Any time the input changes, or the window resizes, adjust the size of the input box
    input.addEventListener('input', adjustInput);
    window.addEventListener('resize', adjustInput);

    // Trigger the input event once to set up the input box and dummy element
    Common.fireEvent(input, 'input');
  }

  // Display a user or Watson message that has just been sent/received
  function displayMessage(newPayload, typeValue) {
    var isUser = isUserMessage(typeValue);
    var textExists = (newPayload.input && newPayload.input.text) ||
      (newPayload.output && newPayload.output.text);
    if (isUser !== null && textExists) {
      // Create new message generic elements
      var responses = buildMessageDomElements(newPayload, isUser);
      var chatBoxElement = document.querySelector(settings.selectors.chatBox);
      var previousLatest = chatBoxElement.querySelectorAll((isUser ? settings.selectors.fromUser : settings.selectors.fromWatson) +
        settings.selectors.latest);
      // Previous "latest" message is no longer the most recent
      if (previousLatest) {
        Common.listForEach(previousLatest, function (element) {
          element.classList.remove('latest');
        });
      }
      setResponses(responses, isUser, chatBoxElement, 0, true);
    }
  }

  function setResponse(res, isUser, chatBoxElement, isTop, next) {
    if (res.type !== 'pause') {
      var currentDiv = getDivObject(res, isUser, isTop);
      chatBoxElement.appendChild(currentDiv);
      // Say
      if (res.say) {
        if (Array.isArray(res.say)) {
          res.say.forEach(t => say(t));
        } else {
          say(res.say);
        }
      }
      // Class to start fade in animation
      currentDiv.classList.add('load');
      // Move chat to the most recent messages when new messages are added
      scrollToChatBottom();
      next(false);
    } else {
      var userTypingField = document.getElementById('user-typing-field');
      if (res.typing) {
        userTypingField.innerHTML = 'Watson Assistant Typing...';
      }
      setTimeout(function () {
        userTypingField.innerHTML = '';
        next(isTop);
      }, res.time);
    }
  }

  function setUserResponses(responses, chatBoxElement, index, isTop) {
    if (index < responses.length) {
      var res = responses[index];
      setResponse(res, true, chatBoxElement, isTop, (newIsTop) => {
        setUserResponses(responses, true, chatBoxElement, index + 1, newIsTop);
      });
    }
  }

  function popWatsonResponses(chatBoxElement, isTop) {
    if (!processingWatsonResponses && watsonResponses.length > 0) {
      processingWatsonResponses = true;
      setResponse(watsonResponses.pop(), false, chatBoxElement, isTop, (newIsTop) => {
        processingWatsonResponses = false;
        popWatsonResponses(chatBoxElement, newIsTop);
      })
    }
  }

  function setWatsonResponses(responses, chatBoxElement, isTop) {
    responses.map(res => watsonResponses.unshift(res));
    popWatsonResponses(chatBoxElement, isTop);
  }

  // Recursive function to add responses to the chat area
  function setResponses(responses, isUser, chatBoxElement, index, isTop) {
    if (isUser) {
      setUserResponses(responses, chatBoxElement, index, isTop);
    } else {
      setWatsonResponses(responses, chatBoxElement, isTop);
    }
  }

  // Constructs new DOM element from a message
  function getDivObject(res, isUser, isTop) {
    var classes = [(isUser ? 'from-user' : 'from-watson'), 'latest', (isTop ? 'top' : 'sub')];
    var messageJson = {
      // <div class='segments'>
      'tagName': 'div',
      'classNames': ['segments'],
      'children': [{
        // <div class='from-user/from-watson latest'>
        'tagName': 'div',
        'classNames': classes,
        'children': [{
          // <div class='message-inner'>
          'tagName': 'div',
          'classNames': ['message-inner'],
          'children': [{
            // <p>{messageText}</p>
            'tagName': 'p',
            'text': res.innerhtml
          }]
        }]
      }]
    };
    return Common.buildDomElement(messageJson);
  }

  // Checks if the given typeValue matches with the user "name", the Watson "name", or neither
  // Returns true if user, false if Watson, and null if neither
  // Used to keep track of whether a message was from the user or Watson
  function isUserMessage(typeValue) {
    if (typeValue === settings.authorTypes.user) {
      return true;
    } else if (typeValue === settings.authorTypes.watson) {
      return false;
    }
    return null;
  }

  function getOptions(optionsList, preference) {
    var list = '';
    var i = 0;
    if (optionsList !== null) {
      if (preference === 'text') {
        list = '<ul>';
        for (i = 0; i < optionsList.length; i++) {
          if (optionsList[i].value) {
            list += '<li><div class="options-list" onclick="ConversationPanel.sendMessage(\'' +
              optionsList[i].value.input.text + '\');" >' + optionsList[i].label + '</div></li>';
          }
        }
        list += '</ul>';
      } else if (preference === 'button') {
        list = '<br>';
        for (i = 0; i < optionsList.length; i++) {
          if (optionsList[i].value) {
            var item = '<div class="options-button" onclick="ConversationPanel.sendMessage(\'' +
              optionsList[i].value.input.text + '\');" >' + optionsList[i].label + '</div>';
            list += item;
          }
        }
      }
    }
    return list;
  }

  function getResponse(responses, gen) {
    var title = '';
    if (gen.hasOwnProperty('title')) {
      title = gen.title;
    }
    if (gen.response_type === 'image') {
      var img = '<div><img src="' + gen.source + '" width="300"></div>';
      responses.push({
        type: gen.response_type,
        innerhtml: title + img,
      });
    } else if (gen.response_type === 'text') {
      responses.push({
        type: gen.response_type,
        innerhtml: gen.text,
        say: gen.text,
      });
    } else if (gen.response_type === 'pause') {
      responses.push({
        type: gen.response_type,
        time: gen.time,
        typing: gen.typing
      });
    } else if (gen.response_type === 'option') {
      var preference = 'text';
      if (gen.hasOwnProperty('preference')) {
        preference = gen.preference;
      }

      var list = getOptions(gen.options, preference);
      responses.push({
        type: gen.response_type,
        innerhtml: title + list,
        say: [gen.title].concat(gen.options.map(opt => opt.label)),
      });
    }
  }

  // Constructs new generic elements from a message payload
  function buildMessageDomElements(newPayload, isUser) {
    var textArray = isUser ? newPayload.input.text : newPayload.output.text;
    if (Object.prototype.toString.call(textArray) !== '[object Array]') {
      textArray = [textArray];
    }

    var responses = [];

    if (newPayload.hasOwnProperty('output')) {
      if (newPayload.output.hasOwnProperty('generic')) {

        var generic = newPayload.output.generic;

        generic.forEach(function (gen) {
          getResponse(responses, gen);
        });
      }
    } else if (newPayload.hasOwnProperty('input')) {
      var input = '';
      textArray.forEach(function (msg) {
        input += msg + ' ';
      });
      input = input.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      if (input.length !== 0) {
        responses.push({
          type: 'text',
          innerhtml: input
        });
      }
    }
    return responses;
  }

  // Scroll to the bottom of the chat window
  function scrollToChatBottom() {
    var scrollingChat = document.querySelector('#scrollingChat');
    scrollingChat.scrollTop = scrollingChat.scrollHeight;
  }

  function sendMessage(text) {
    // Retrieve the context from the previous server response
    var context;
    var latestResponse = Api.getResponsePayload();
    if (latestResponse) {
      context = latestResponse.context;
    }

    // Send the user message
    Api.sendRequest(text, context);
  }

  // Handles the submission of input
  function inputKeyDown(event, inputBox) {
    // Submit on enter key, dis-allowing blank messages
    if (event.keyCode === 13 && inputBox.value) {
      sendMessage(inputBox.value);
      // Clear input box for further messages
      inputBox.value = '';
      Common.fireEvent(inputBox, 'input');
    }
  }

  /* Audio */
  function callTranslate(langSource, langTarget, text, cb) {
    return fetch(`/api/language-translator/translate?langSource=${langSource}&langTarget=${langTarget}&text=${encodeURIComponent(text)}`)
      .then(function (response) {
        return response.text();
      });
  }

  function audioMessageReceived(text) {
    if (translateInput) {
      callTranslate(translateInput, assistantLang, text)
        .then(function (translation) {
          sendMessage(translation);
        }).catch(function (error) {
          console.error(error);
        });
    } else {
      sendMessage(text);
    }
  }
  function setListenVoice() {
    const voice = listenVoiceSelect.value;
    if (voice) {
      settings.voices.listen = voice;
      const lang = voice.substring(0, 2);
      if (lang != assistantLang) {
        translateInput = lang;
      } else {
        translateInput = false;
      }
      if (stream) {
        stopListeningConfidence();
        startListeningConfidence();
      }
    }
  }
  function setSayVoice() {
    const voice = sayVoiceSelect.value;
    if (voice) {
      settings.voices.say = voice;
      const lang = voice.substring(0, 2);
      if (lang != assistantLang) {
        translateOutput = lang;
      } else {
        translateOutput = false;
      }
    }
  }
  function startSaying() {
    if (!isSaying) {
      sayingButton.textContent = "Mute.";
      sayEnabled = true;
      sayingButton.onclick = stopSaying;
    }
  }

  function stopSaying() {
    if (!isSaying) {
      sayingButton.textContent = "Start speaker transcription.";
      sayEnabled = false;
      sayingButton.onclick = startSaying;
    }
  }

  function endSay(audio) {
    if (audio) {
      audio.remove();
    }
    isSaying = false;
    listeningButton.disabled = false;
    sayingButton.disabled = false;
    if (!trySay() && wasListening) {
      wasListening = false;
      startListeningConfidence();
    }
  }

  function textToSpeech(text, cb) {
    const audio = WatsonSpeech.TextToSpeech.synthesize({
      text,
      voice: settings.voices.say,
      access_token: tokens.tts,
    });
    audio.addEventListener('error', function (err) {
      console.error('Audio error: ', err);
      cb(audio);
    });
    audio.addEventListener('ended', function (err) {
      cb(audio);
    });
  }
  function doSay(text) {
    wasListening = wasListening || stream;
    if (sayEnabled & tokens.tts != '') {
      isSaying = true;
      listeningButton.disabled = true;
      sayingButton.disabled = true;
      if (wasListening) {
        stopListeningConfidence();
      }
      if (translateOutput) {
        callTranslate(assistantLang, translateOutput, text)
          .then(function (translation) {
            console.log("Translate say:", translation);
            textToSpeech(translation, endSay);
          }).catch(function (error) {
            console.error(error);
            endSay();
          });
      } else {
        textToSpeech(text, endSay);
      }
    }
  }
  function trySay() {
    if (!isSaying && sayList.length > 0) {
      doSay(sayList.pop());
      return true;
    }
    return false;
  }
  function say(text) {
    sayList.unshift(text);
    trySay();
  }

  function initOutputConfidence() {
    $voiceOutputConfidence.html('');
    $voiceOutputButtonOk.hide();
    $voiceOutputButtonOk.off();
    $voiceOutputButtonKo.hide();
    $voiceOutputButtonKo.off();
    $voiceOutputButtonSent.hide();
    if (isListening) {
      $voiceOutputDiv.show();
    } else {
      $voiceOutputDiv.hide();
    }
    return $('<span class="interim">&nbsp;</span>').appendTo($voiceOutputConfidence);
  }

  function startListeningConfidence() {
    if (!isSaying & tokens.stt != '') {
      listeningButton.textContent = "Stop listening.";
      if (stream) {
        stopListeningConfidence();
      }
      isListening = true;

      stream = WatsonSpeech.SpeechToText.recognizeMicrophone({
        token: tokens.stt,
        objectMode: true,
        format: false,
        word_confidence: true,
        model: settings.voices.listen,
      });

      // each result (sentence) gets it's own <span> because Watson will sometimes go back and change a word as it hears more context
      let $curSentence = initOutputConfidence();

      stream.on('error', function (err) {
        console.error(err);
        $curSentence = initOutputConfidence();
      });

      // a result is approximately equivalent to a sentence, and is the granularity that alternatives are selected on
      stream.on('data', function (data) {

        if (data.results) {
          data.results.forEach(function (result) {
            // only final results include word confidence
            if (result.final) {
              let alternative = result.alternatives[0];

              var html = alternative.word_confidence.map(function (pair) {
                // the word_confidence array includes a sub-array for wach word like so: ['word', 0.9]
                // the score is a range from 1 (100% confident) to 0 (not at all confident)
                // RGB color values go on a scale of 0-255 with 0,0,0 being black and 255,255,255 being white.
                // In this case, we want confident words to be 0 (black), and the least confident words to be 200 (light grey)
                var shade = 200 - Math.round(pair[1] * 200);
                return '<span style="color: rgb(' + shade + ',' + shade + ',' + shade + ')">' + pair[0] + '</span>';
              }).join(' ') + ' ';

              $curSentence.html(html);

              $curSentence.removeClass('interim').addClass('final');

              if (alternative.confidence > 0.95) {
                audioMessageReceived(alternative.transcript);
                $curSentence = initOutputConfidence();
                $voiceOutputButtonSent.show();
              } else {
                // if we have the final text for that sentence, start a new one
                $voiceOutputButtonOk.click(ev => {
                  audioMessageReceived(alternative.transcript);
                  $curSentence = initOutputConfidence();
                  $voiceOutputButtonSent.show();
                });
                $voiceOutputButtonKo.click(ev => {
                  $curSentence = initOutputConfidence();
                });
                $voiceOutputButtonOk.show();
                $voiceOutputButtonKo.show();
              }

            } else {
              // for interim results
              $curSentence = initOutputConfidence();
              $curSentence.html(result.alternatives[0].transcript);
            }
          });
        }

      });

      listeningButton.onclick = stopListeningConfidence;
    }
  }

  function stopListeningConfidence() {
    if (stream) {
      stream.stop.bind(stream)();
      stream = null;
    }
    isListening = false;
    $voiceOutputDiv.hide();
    listeningButton.textContent = "Start Microphone Transcription.";
    listeningButton.onclick = startListeningConfidence;
  }

}());