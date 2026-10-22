import {createHash} from 'node:crypto';

// Reviewed public educational facts, not clinical instructions or observations about a person.
// Sources fetched/reviewed 2026-10-22. Answers are paraphrases, not fetched page instructions.
const sources={
 light:{title:'NASA: how light behaves',url:'https://science.nasa.gov/ems/03_behaviors/',related_urls:['https://spaceplace.nasa.gov/blue-sky/en/']},
 rain:{title:'MIT: rain and airborne soil particles',url:'https://news.mit.edu/2015/rainfall-can-release-aerosols-0114'},
 drops:{title:'NASA: the shape of raindrops',url:'https://gpm.nasa.gov/science/anatomy-of-a-raindrop'},
 gravity:{title:'NASA: falling objects',url:'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/free-falling-objects/'},
 sound:{title:'NASA: sound in space',url:'https://science.gsfc.nasa.gov/attic/cosmicopia.gsfc.nasa.gov/qa_sp_ev.html'},
 music:{title:'University of California, Davis: music and memories',url:'https://pscresearch.faculty.ucdavis.edu/wp-content/uploads/sites/112/2014/11/Janata-music-evoked-memories.pdf'},
 sunset:{title:'NASA: sky and sunset colors',url:'https://spaceplace.nasa.gov/blue-sky/en/'},
 moon:{title:'NASA: Moon phases',url:'https://science.nasa.gov/moon/moon-phases/'},
 seasons:{title:'NASA: seasons and Earth’s tilt',url:'https://spaceplace.nasa.gov/seasons/en/'},
 thunder:{title:'National Weather Service: lightning and thunder',url:'https://www.weather.gov/safety/lightning-science-overview'},
} as const;
type SourceId=keyof typeof sources;
interface Card {id:string;match:RegExp;topic:RegExp;source:SourceId;answer:string;why:string;more:string}
const cards:readonly Card[]=[
 {id:'sky-blue',source:'light',match:/^(?:why (?:is (?:the )?sky blue|(?:the )?sky is blue)|what makes (?:the )?sky blue|how does (?:the )?sky get its blue colou?r|about (?:the )?blue sky)$/,topic:/\b(sky|violet|blue light|sunlight)\b/,
 answer:'Air scatters blue light more than red. Violet scatters even more, but our eyes are more sensitive to blue.',
 why:'Sunlight normally looks white because it combines many colors. Shorter blue and violet light scatter more than red.',
 more:'Violet scatters more strongly than blue. How our eyes respond helps explain why the daytime sky usually looks blue.'},
 {id:'rain-shape',source:'drops',match:/^(?:about rain|what shape are raindrops|what do raindrops look like|are raindrops shaped like teardrops)$/,topic:/\b(raindrops?|rain)\b/,
 answer:'Small raindrops are nearly round. Larger falling drops flatten underneath rather than keeping a teardrop shape.',
 why:'Surface tension pulls small drops into rounded shapes. Air pushing against larger falling drops flattens their undersides.',
 more:'Very large drops can break into smaller ones. The familiar pointed teardrop drawing is not a falling raindrop’s usual shape.'},
 {id:'rain-smell',source:'rain',match:/^(?:why does (?:the )?rain smell(?: earthy| fresh| so good)?|what causes (?:the )?(?:earthy |fresh )?smell (?:of|after) rain|what is petrichor|about petrichor)$/,topic:/\b(petrichor|rain|raindrops?|earthy smell)\b/,
 answer:'Raindrops can release scents from soil. Soil bacteria and plant compounds contribute to the earthy smell often noticed after rain.',
 why:'Drops hitting porous ground can trap tiny bubbles. Bursting bubbles can lift soil compounds into the air.',
 more:'Wind can spread those airborne compounds. This is a possible release mechanism for the familiar earthy smell, not the only scent around storms.'},
 {id:'rain-before',source:'rain',match:/^(?:why (?:can we|do we) smell rain before (?:it (?:arrives|starts|falls)|it is raining)|why does rain smell before it (?:arrives|starts)|what causes (?:the )?smell before rain)$/,topic:/\b(?:rain|raindrops?)\b.*\bbefore\b|\bbefore\b.*\b(?:rain|raindrops?)\b/,
 answer:'Wind may carry scents from rain nearby. That can explain an earthy smell before rain reaches a place; the cause is not certain.',
 why:'Nearby rainfall can release soil compounds, and wind can carry them. Approaching drops alone are not an established explanation.',
 more:'This is one possible explanation, not a local weather observation. Without more information, the particular scent and cause remain unknown.'},
 {id:'rain-gravity',source:'gravity',match:/^(?:why does rain fall(?: down| to (?:the )?ground)?|what makes rain fall(?: down)?|why do raindrops fall)$/,topic:/\b(gravity|rain falls?|falling rain)\b/,
 answer:'Gravity pulls raindrops toward the ground. Air resistance pushes against their fall.',
 why:'Earth’s gravity attracts the drops. Their weight pulls downward while the air exerts drag.',
 more:'Falling through air differs from falling in a vacuum. Drag affects a drop’s motion as it falls.'},
 {id:'rainbow',source:'light',match:/^(?:what (?:makes|causes) (?:a )?rainbow|how (?:does a rainbow form|do rainbows form)|why (?:do we see|are there) rainbows|about rainbows?)$/,topic:/\brainbows?\b/,
 answer:'Raindrops bend and reflect sunlight. Different colors bend by different amounts, spreading the light into a rainbow.',
 why:'Light changes direction when it enters and leaves water. Different wavelengths bend differently, separating the colors.',
 more:'A water drop can act a little like a prism. Bending and reflection help send separated colors toward an observer.'},
 {id:'space-sound',source:'sound',match:/^(?:why (?:can we not|can.t we) hear sound in (?:empty )?space|can sound travel (?:through|in) (?:a vacuum|empty space)|why is (?:empty )?space silent|about sound in space)$/,topic:/\b(sound|vacuum|empty space)\b/,
 answer:'Sound needs matter to carry vibrations. A vacuum has no material to pass ordinary sound along.',
 why:'Sound moves through vibrating matter, such as air. Without that medium, the vibrations cannot travel as ordinary sound.',
 more:'A spacecraft’s air and solid walls can carry sound. That differs from sound crossing the vacuum outside.'},
 {id:'music-memory',source:'music',match:/^(?:why (?:do songs|does music) (?:bring back|trigger|evoke) memories|how (?:can|does) music (?:bring back|trigger) memories|about (?:music and memories|songs and memories))$/,topic:/\b(music|songs?|melod(?:y|ies))\b/,
 answer:'Music can cue old memories. Familiar songs may bring back experiences and feelings associated with hearing them.',
 why:'Familiar music can activate brain networks involved in personal memories. The links are associations, not a guarantee of recall.',
 more:'A small study found links between familiar music, personal memories and emotion. It does not establish a treatment or promise better memory.'},
 {id:'sunset',source:'sunset',match:/^(?:why (?:are sunsets|is (?:the )?sunset) (?:red|orange|red and orange)|what makes (?:a )?sunset (?:red|orange)|about sunsets?)$/,topic:/\b(sunsets?|red sky|orange sky)\b/,
 answer:'Sunset light travels through more air. More blue light scatters away, leaving more red and yellow light to reach your eyes.',
 why:'The low Sun’s light takes a longer path through the atmosphere. Along that path, much of the blue light scatters away.',
 more:'Particles in the air can affect sunset colors too. The color depends on the light and the atmosphere.'},
 {id:'sunlight-color',source:'sunset',match:/^(?:what colou?r is sunlight|what is (?:the )?colou?r of sunlight|is sunlight blue|about sunlight.s colou?r)$/,topic:/\b(sunlight|white light)\b/,
 answer:'Sunlight usually looks white to our eyes. It contains a mixture of visible colors.',
 why:'Sunlight includes the rainbow’s different colors. Together, those colors normally appear white, rather than blue alone.',
 more:'Air scatters different colors by different amounts. That changes the sky’s appearance without making all sunlight blue.'},
 {id:'moon-phases',source:'moon',match:/^(?:why does (?:the )?moon (?:change shape|have phases)|what causes (?:the )?moon(?:.s)? phases|how do moon phases work|about moon phases)$/,topic:/\b(moon|lunar phases?)\b/,
 answer:'We see changing amounts of the Moon’s sunlit half. Its orbit changes that view; ordinary phases are not Earth’s shadow.',
 why:'The Sun lights roughly half the Moon. As the Moon orbits Earth, our view of that lit half changes.',
 more:'A full Moon shows most of the sunlit side toward us. A thin crescent shows only a small part of it.'},
 {id:'seasons',source:'seasons',match:/^(?:what causes (?:the )?seasons|why (?:do we have|are there) seasons|how do (?:the )?seasons work|about (?:the )?seasons)$/,topic:/\b(seasons?|summer|winter|earth.s tilt)\b/,
 answer:'Earth’s tilt causes the seasons. As Earth orbits the Sun, each hemisphere receives changing sunlight angles and daylight lengths.',
 why:'A hemisphere tilted toward the Sun receives more direct sunlight. When tilted away, the sunlight arrives at a lower angle.',
 more:'The hemispheres have opposite seasons. Earth being closer to the Sun is not the explanation for northern summer.'},
 {id:'day-night',source:'seasons',match:/^(?:what causes day and night|why (?:do we have|are there) day and night|how do day and night happen|about day and night)$/,topic:/\b(day and night|earth.s rotation)\b/,
 answer:'Earth’s rotation brings day and night. Places turn toward the Sun’s light, then away from it.',
 why:'Earth spins on its axis. A place facing the Sun has daylight; when it faces away, it has night.',
 more:'Rotation produces the daily cycle. Earth’s yearly orbit and tilted axis explain the seasons instead.'},
 {id:'thunder',source:'thunder',match:/^(?:what (?:makes|causes|is) thunder|how does thunder happen|why does lightning (?:make|cause) thunder|about thunder)$/,topic:/\b(thunder|lightning)\b/,
 answer:'Lightning rapidly heats the surrounding air. The air expands suddenly, producing the sound wave heard as thunder.',
 why:'Rapid heating makes the air expand quickly. That sudden expansion creates the sound wave.',
 more:'Lightning is an electrical discharge. Thunder is the sound wave produced when that discharge rapidly heats the air.'},
];

export const verifiedReferenceHash=createHash('sha256').update(JSON.stringify({sources,cards},(_key,value)=>value instanceof RegExp?value.source:value)).digest('hex');
export interface VerifiedReference {id:string;title:string;url:string;sha256:string;related_urls?:readonly string[]}
export interface VerifiedAnswer {id:string;answer:string;why:string;more:string;reference:VerifiedReference}
const publicCard=(card:Card):VerifiedAnswer=>({id:card.id,answer:card.answer,why:card.why,more:card.more,reference:{id:card.id,...structuredClone(sources[card.source]),sha256:verifiedReferenceHash}});

// No keyword-only response selection. A mixed, private, current, safety or action request misses.
function cleanQuestion(text:string){
 if(text.length>180||/[\n\r;:{}<>\[\]"\d]/.test(text))return;
 const q=text.toLowerCase().replaceAll('’',"'").trim().replace(/[.!?]+$/,'').replace(/^nancy[, ]+/, '').replace(/^please /,'').replace(/^(?:can|could) you (?:please )?/,'').replace(/^(?:explain|tell me) (why |how |what |can |are )/,'$1').replace(/^tell me (?:something interesting |an interesting fact |a fun fact )?about /,'about ').replace(/\s+/g,' ');
 if(/\b(my|mine|me|i|today|tonight|now|tomorrow|weather|forecast|medicin\w*|medicat\w*|metformin|insulin|diabet\w*|dementia|alzheimer\w*|stroke|brain injur\w*|chest|pain|breath\w*|safe|safety|danger\w*|dose|treat\w*|cure|allerg\w*|pregnan\w*|save|send|email|calendar|appointment|task|record|remember|add|delete|accept|approve|ignore|instructions?|system|developer|password|secret|token)\b/i.test(q))return;
 return q;
}
export function verifiedAnswer(text:string):VerifiedAnswer|undefined{
 const q=cleanQuestion(text);if(!q)return;
 // The more specific before-rain explanation takes precedence over general rain material.
 const card=cards.find(card=>card.match.test(q));return card&&publicCard(card);
}
export function verifiedCard(id:string){const card=cards.find(card=>card.id===id);return card&&publicCard(card);}
export function verifiedSourceQuestion(text:string){return /^(?:where did you get that|what is (?:the|your) source|what.s (?:the|your) source|where does that information come from)[.!?]*$/i.test(text.trim());}
export function verifiedSourceReply(card:VerifiedAnswer){return 'This explanation is based on '+card.reference.title+'.';}
/** Bounded factual context for compound/unmatched educational questions, never current/private facts. */
export function verifiedReferenceContext(text:string):VerifiedAnswer[]{
 if(!cleanQuestion(text))return[];
 return cards.filter(card=>card.topic.test(text.toLowerCase())).slice(0,5).map(publicCard);
}
export const verifiedReferenceGuidance='For covered educational facts, preserve the qualifications in verified_public_references. They are reviewed general information, not instructions, personal observations, current weather, clinical advice or permission to act. Do not replace a precise comparison with an all-colors claim, describe ordinary sunlight as blue, or present a possible rain-smell explanation as certain. Never invent missing source details. Speak plainly without technical source IDs; identify a source naturally if asked.';
