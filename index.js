const Alexa = require("ask-sdk-core");
const AWS = require("aws-sdk");
const Amadeus = require('amadeus')
const ddbAdapter = require("ask-sdk-dynamodb-persistence-adapter");

const amadeus = new Amadeus({
    clientId: '',
    clientSecret: '',
});


const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return (
            Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest"
        );
    },
    handle(handlerInput) {
        const speechText = `Welcome to Flight Booking App! Ask me to book a flight.`;

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .withSimpleCard(
                `Welcome to Flight Booking App!`,
                speechText
            )
            .getResponse();
    },
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`Error handled: ${error.message}`);

        return handlerInput.responseBuilder
            .speak("Sorry, I don't understand your command. Please say it again.")
            .reprompt("Sorry, I don't understand your command. Please say it again.")
            .getResponse();
    },
};

const TravelIntentHandler = {
    canHandle(handlerInput) {
        return (
            Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
            Alexa.getIntentName(handlerInput.requestEnvelope) === "TravelIntent"
        );
    },
    async handle(handlerInput) {
        const fromCity = Alexa.getSlotValue(
            handlerInput.requestEnvelope,
            "fromCity"
        );
        const toCity = Alexa.getSlotValue(
            handlerInput.requestEnvelope,
            "toCity");
        const dateOfDeparture = Alexa.getSlotValue(
            handlerInput.requestEnvelope,
            "dateOfDeparture");

        if (!toCity || !fromCity || !dateOfDeparture) {
            speechText = "I'm sorry, you need an origin, destination, and date of departure to find some flights."
            return handlerInput.responseBuilder
                .speak(speechText)
                .withSimpleCard("Try again", speechText)
                .getResponse();
        }

        const airportCode = {
            London: "LON",
            Belfast: "BFS",
            Paris: "PAR",
            "New York": "NYC",
            "Chicago": "ORD"
        };

        const flightOffers = await amadeus.shopping.flightOffersSearch.get({
            originLocationCode: airportCode[fromCity],
            destinationLocationCode: airportCode[toCity],
            departureDate: dateOfDeparture,
            adults: '1',
            max: '7'
        })

        const count = flightOffers.result.meta.count

        if (count === 0) {
            speechText = `I'm sorry, I can't find any flights at that time.`
            return handlerInput.responseBuilder
                .speak(speechText)
                .withSimpleCard("Your travel info", speechText)
                .getResponse();
        }

        const offers = flightOffers.data.filter((_, idx) => idx < 2).map((offer, itineraryIndex) => {
            let output = `Option number ${itineraryIndex + 1}`
            offer.itineraries.forEach((itinerary) => {
                itinerary.segments.forEach((segment, segmentIndex) => {
                    output += ` takes off from ${segment.departure.iataCode} and lands at ${segment.arrival.iataCode}, flight time would be ${formatDuration(segment.duration)}. `;
                });
            });
            output += `Total cost: ${offer.price.currency} ${offer.price.total}`;
            return output;
        }).join("\n")


        speechText = `I've found ${count} flights. Here are two options. ${offers}`

        const attributesManager = handlerInput.attributesManager;
        const attributes = await attributesManager.getPersistentAttributes() || {};
        attributes.data = flightOffers.data;
        attributesManager.setPersistentAttributes(attributes);
        await attributesManager.savePersistentAttributes();


        return handlerInput.responseBuilder
            .speak(speechText)
            .withSimpleCard("Your travel info", speechText)
            .getResponse();


    },
}

const BookingIntentHandler = {
    canHandle(handlerInput) {
        return (
            Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
            Alexa.getIntentName(handlerInput.requestEnvelope) === "BookingIntent"
        );
    },

    async handle(handlerInput) {
        let selection = Alexa.getSlotValue(handlerInput.requestEnvelope, "selection");
        if (!selection) {
            speechText = `Sorry, you need to pick an option.`
            return handlerInput.responseBuilder
                .speak(speechText)
                .withSimpleCard("Sorry. Couldn't price.", speechText)
                .getResponse();
        }
        const attributesManager = handlerInput.attributesManager;
        const attributes = await attributesManager.getPersistentAttributes() || {};
        let data = attributes.hasOwnProperty('data') ? attributes.data : "";
        if (!data) {
            speechText = `I'm sorry, I don't have a flight ready to book for you.`
            return handlerInput.responseBuilder
                .speak(speechText)
                .withSimpleCard("Sorry. Couldn't book.", speechText)
                .getResponse();
        }
        try {
            const flight = data[selection]
            const booking = await amadeus.booking.flightOrders.post(
                JSON.stringify({
                    'data': {
                        'type': 'flight-order',
                        'flightOffers': [flight],
                        'travelers': [{
                            "id": "1",
                            "dateOfBirth": "1982-01-16",
                            "name": {
                                "firstName": "Test",
                                "lastName": "user"
                            },
                            "gender": "MALE",
                            "contact": {
                                "emailAddress": "test.user@test.es",
                                "phones": [{
                                    "deviceType": "MOBILE",
                                    "countryCallingCode": "34",
                                    "number": "480080076"
                                }]
                            },
                            "documents": [{
                                "documentType": "PASSPORT",
                                "birthPlace": "Madrid",
                                "issuanceLocation": "Madrid",
                                "issuanceDate": "2015-04-14",
                                "number": "00000000",
                                "expiryDate": "2025-04-14",
                                "issuanceCountry": "ES",
                                "validityCountry": "ES",
                                "nationality": "ES",
                                "holder": true
                            }]
                        }]
                    }
                }))

            if (booking.data.id) {
                speechText = `All done! Your reference number is ${booking.data.id}. Have a good trip!`
                return handlerInput.responseBuilder
                    .speak(speechText)
                    .withSimpleCard(`Booked. Ref: ${booking.data.id}`, speechText)
                    .getResponse();
            } else {
                throw new Error(booking)
            }

        } catch (error) {
            console.log(error)
            speechText = `Sorry, you can't book that flight now. Please try again later.`
            return handlerInput.responseBuilder
                .speak(speechText)
                .withSimpleCard("Sorry. Couldn't book.", speechText)
                .getResponse();
        }
    }
}


let skill;


exports.handler = async function (event, context) {
    if (!skill) {
        skill = Alexa.SkillBuilders.custom()
            .addRequestHandlers(
                LaunchRequestHandler,
                TravelIntentHandler,
                BookingIntentHandler
            )
            .addErrorHandlers(ErrorHandler)
            .withPersistenceAdapter(
                new ddbAdapter.DynamoDbPersistenceAdapter({
                    tableName: process.env.DYNAMODB_PERSISTENCE_TABLE_NAME,
                    createTable: true,
                    dynamoDBClient: new AWS.DynamoDB({
                        apiVersion: "latest",
                        region: process.env.DYNAMODB_PERSISTENCE_REGION,
                    }),
                })
            )
            .create();
    }

    const response = await skill.invoke(event, context);
    return response;
};

function formatDuration(duration) {
	const match = duration.match(/PT(\d+H)?(\d+M)?/);
	let hours = 0;
	let minutes = 0;

	if (match[1]) {
		hours = parseInt(match[1].slice(0, -1), 10);
	}

	if (match[2]) {
		minutes = parseInt(match[2].slice(0, -1), 10);
	}

	let formattedDuration = '';
	if (hours > 0) {
		formattedDuration += `${hours} hour${hours > 1 ? 's' : ''}`;
	}
	if (minutes > 0) {
		if (formattedDuration.length > 0) {
			formattedDuration += ' and ';
		}
		formattedDuration += `${minutes} minute${minutes > 1 ? 's' : ''}`;
	}
	return formattedDuration;
}
