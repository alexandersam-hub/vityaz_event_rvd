const { WebSocketServer } = require('ws');
const questionService = require('../services/questionService')
const quizService = require('../services/quizService')
const roomService = require('../services/roomService')
const md5 = require('md5')
const { v4: uuidv4 } = require('uuid');

const timeRound =  Number(process.env.ROUND_TIME)

class RoomGame {
    session
    id = 1
    adminSocket
    isStart = false
    isFinish =false
    quiz
    questions
    usersSockets = []
    gameSocket
    currentTask = 0
    score={}
    timerEnd=false
    timerStart=false
    timerPause=false
    stepRound='preparation'
    logAnswers={}
    time=timeRound
    timer = null

    constructor() {
        this.session= uuidv4();
    }
}

class GameSocketController{

    ws
    rooms = {}

    async resetScore(roomId){
        // delete(this.rooms[roomId])
        if (!this.rooms[roomId])
            return false
        this.rooms[roomId].isStart = false
        this.rooms[roomId].progrss = {}
        this.rooms[roomId].score = {}
        this.rooms[roomId].timerEnd = false
        this.rooms[roomId].stepRound='preparation'
        this.rooms[roomId].currentTask = 0
        const roomArchive = await this.getArchive(roomId)
        try{
            const quizRes =  await quizService.getQuizById(roomArchive.room.quiz)
            if (quizRes)
                this.rooms[roomId].quiz = quizRes
            else
                this.rooms[roomId].quiz = 'none'
        }catch (e){
            this.rooms[roomId].quiz = 'none'
            console.log("Ошибка при обращении к  quizService.getQuizById \n" + e)
        }

        const tasks = await questionService.getQuestionByQuizId(roomArchive.room.quiz)
        tasks.questions[tasks.questions.length - 1].isFinishQuestion = true
        this.rooms[roomId].questions = tasks.questions
        this.rooms[roomId].teamsName = roomArchive.room.teamsName?roomArchive.room.teamsName:[]
        this.rooms[roomId].teamsCode = []
        this.rooms[roomId].teamsName.forEach((teamName,i)=>
            this.rooms[roomId].teamsCode.push({teamName, teamCode:md5(roomId+i)}))
        this.sendGame( this.rooms[roomId])
    }

    async init(server, isLocalServer){
        try{
            if (isLocalServer)
                this.ws = new WebSocketServer({port:8100});
            else
                this.ws = new WebSocketServer({server});
            //
            this.ws.on('connection', (ws) =>{
                let type
                let id = 0
                let room
                ws.on('message', async (data)=> {
                    const messageData = JSON.parse(data)
                    // console.log('messageData',messageData)
                    switch (messageData.action) {
                        case 'login':
                            type = messageData.type
                            room = messageData.room
                            if(!this.rooms[messageData.room] && room){
                                const roomArchive = await this.getArchive(room)
                                if (roomArchive.warning)
                                    return this.sendErrorMessage(ws, 404, id)
                                this.rooms[messageData.room] = new RoomGame()
                                const quizRes =  await quizService.getQuizById(roomArchive.room.quiz)
                                if (quizRes)
                                    this.rooms[messageData.room].quiz = quizRes
                                else
                                    this.rooms[messageData.room].quiz = 'none'
                                const tasks = await questionService.getQuestionByQuizId(roomArchive.room.quiz)

                                tasks.questions[tasks.questions.length - 1].isFinishQuestion = true

                                this.rooms[messageData.room].questions = tasks.questions
                                // console.log('tasks', this.rooms[messageData.room].questions[tasks.questions.length - 1])
                                const actualRoom = roomArchive.room.progress
                                this.rooms[messageData.room].isStart = false
                                this.rooms[messageData.room].stepRound='preparation'
                                this.rooms[messageData.room].isFinish = actualRoom.isFinish? actualRoom.isFinish:false
                                this.rooms[messageData.room].score = actualRoom.score?actualRoom.score:{}
                                this.rooms[messageData.room].logAnswers = actualRoom.logAnswers?actualRoom.logAnswers:{}
                                if(!this.rooms[messageData.room].logAnswers[0])
                                    this.rooms[messageData.room].logAnswers[0] = {}
                                this.rooms[messageData.room].currentTask = actualRoom.currentTask >0?actualRoom.currentTask:0
                                this.rooms[messageData.room].teamsName = roomArchive.room.teamsName?roomArchive.room.teamsName:[]
                                this.rooms[messageData.room].teamsCode = []
                                this.rooms[messageData.room].teamsName.forEach((teamName,i)=>
                                    this.rooms[messageData.room].teamsCode.push({teamName, teamCode:md5(messageData.room+i)}))
                            }
                            if(messageData.type === 'game') {
                                const roomArchive = await this.getArchive(room)
                                // console.log( roomArchive.room.progress )

                                if (!roomArchive.warning && Object.keys(roomArchive.room.progress).length === 0){
                                    this.rooms[messageData.room].isStart = false
                                    this.rooms[messageData.room].isFinish = false
                                    this.rooms[messageData.room].score = {}
                                    this.rooms[messageData.room].logAnswers = {}
                                    this.rooms[messageData.room].currentTask = 0
                                    this.rooms[messageData.room].teamsName = roomArchive.room.teamsName?roomArchive.room.teamsName:[]
                                    this.rooms[messageData.room].teamsCode = []
                                    this.rooms[messageData.room].teamsName.forEach((teamName,i)=>
                                        this.rooms[messageData.room].teamsCode.push({teamName, teamCode:md5(messageData.room+i)}))
                                }
                                // console.log( this.rooms[messageData.room].currentTask )


                                this.rooms[messageData.room].gameSocket = ws
                                // console.log("connect",  this.rooms[messageData.room].adminSocket = ws)
                                id =  this.rooms[messageData.room].id
                                this.rooms[messageData.room].id++
                                this.sendGame(this.rooms[messageData.room],id )
                                this.rooms[messageData.room].stepRound='preparation'
                            }
                            else if(messageData.type === 'admin'){
                                this.rooms[messageData.room].adminSocket = ws
                                id =  this.rooms[messageData.room].id
                                this.rooms[messageData.room].id++
                                this.sendGame(this.rooms[messageData.room], id)

                            }

                            else if(messageData.type === 'user'){
                                //console.log(this.rooms[messageData.room].usersSockets.length,messageData.session, messageData.userId,this.rooms[messageData.room].session ,messageData.userId )
                                if(!messageData.room)
                                    return
                                // console.log('messageData',messageData)
                                id =  this.rooms[messageData.room].id
                                if (messageData.session
                                    && this.rooms[messageData.room].session === messageData.session
                                    &&  messageData.userId && messageData.userId >=0 ){
                                    const currentUserId = this.rooms[messageData.room].usersSockets.find(user => user.id === id)

                                    if(currentUserId)
                                        this.rooms[messageData.room].id++
                                    else
                                        id = messageData.userId
                                    // console.log('id',id)
                                    this.rooms[messageData.room].usersSockets.push({id, ws,
                                        teamName:this.rooms[messageData.room] && this.rooms[messageData.room].teamsCode&&this.rooms[messageData.room].teamsCode.find(team=>team.teamCode === messageData.token)?this.rooms[messageData.room].teamsCode.find(team=>team.teamCode === messageData.token).teamName :[],
                                        teamCode: messageData.token})

                                }else{
                                    // console.log(this.rooms[messageData.room].teamsCode)
                                    this.rooms[messageData.room].usersSockets.push({id,ws,
                                        teamName:this.rooms[messageData.room].teamsCode&&this.rooms[messageData.room].teamsCode.find(team=>team.teamCode === messageData.token)?this.rooms[messageData.room].teamsCode.find(team=>team.teamCode === messageData.token).teamName :[],
                                        teamCode: messageData.token})
                                    this.rooms[messageData.room].id++
                                }
                                this.sendGame(this.rooms[messageData.room],id )
                                this.getScoreWs(this.rooms[messageData.room],ws)
                                // console.log('id',id)

                                // console.log(this.rooms[messageData.room].teamsName)

                                // const userData = token
                                // id = this.rooms[messageData.room].id
                                // this.rooms[messageData.room].id++
                                //
                                // console.log(this.rooms[messageData.room].stepRound )
                                if (this.rooms[messageData.room].stepRound ==='score')
                                    this.sendScorePlayer(this.rooms[messageData.room])
                            }
                            if (this.rooms[messageData.room] && (this.rooms[messageData.room].adminSocket || this.rooms[messageData.room].gameSocket)){
                                // console.log(this.rooms[messageData.room].adminSocket || this.rooms[messageData.room].gameSocket )
                                // this.sendGame(this.rooms[messageData.room],id )
                            }else{
                                this.sendGame(this.rooms[messageData.room],id, 390 )
                            }
                            this.sendScoreAdmin(this.rooms[room])
                            break
                        case 'start':
                            // console.log('start_game')
                            this.rooms[messageData.room].isStart = true
                            this.rooms[messageData.room].timerEnd=false

                            this.rooms[messageData.room].timerStart=false
                            this.rooms[messageData.room].time=timeRound
                            if(this.rooms[messageData.room].timer){
                                clearInterval(this.rooms[messageData.room].timer)
                            }
                            this.rooms[messageData.room].stepRound='game'
                            this.rooms[messageData.room].currentTimeStamp = new Date().valueOf()
                            this.rooms[messageData.room].isFirstRightAnswer = false
                            this.rooms[messageData.room].isFirstWrongAnswer = false
                            for(let i in  this.rooms[messageData.room].score){
                                this.rooms[messageData.room].score[i].last =   this.rooms[messageData.room].score[i].current
                            }
                            // this.rooms[messageData.room].score.map(s=>{
                            //     s.current = 0
                            // })
                            //this.rooms[messageData.room].score[ this.rooms[messageData.room].currentTask] = {}
                            //this.rooms[messageData.room].logAnswers[ this.rooms[messageData.room].currentTask] = {}
                            this.sendGame(this.rooms[messageData.room], id)
                            break

                        case 'finish':
                            // console.log('finish')
                            this.rooms[messageData.room].isFinish = true
                            this.rooms[messageData.room].stepRound='finish'
                            this.finishSend(this.rooms[messageData.room])
                            break
                        case 'refresh':
                            break
                        case 'view_answer':
                            const message = {
                                action:'view_answer',
                            }
                            this.rooms[messageData.room].gameSocket.send(JSON.stringify(message) )
                            break



                        case 'timer_start':
                            // if (this.rooms[room].currentTimeStamp<=0 || !this.rooms[messageData.room].timerPause)
                            //     this.rooms[room].currentTimeStamp = new Date().valueOf()
                            console.log('timer_start')
                            if( this.rooms[messageData.room].timer)
                                clearInterval(this.rooms[messageData.room].timer)
                            this.rooms[messageData.room].timerStart = true
                            this.rooms[messageData.room].timerPause = false
                            this.rooms[messageData.room].timer = setInterval(()=>{
                                if (this.rooms[messageData.room].time <= 0){
                                    this.eventTimerEnd(messageData.room)
                                }else {
                                    this.rooms[messageData.room].time --
                                    this.sendTime( this.rooms[messageData.room])
                                }
                            },1000)
                            this.sendGame(this.rooms[messageData.room])
                            break

                        case 'timer_stop':
                            this.rooms[messageData.room].timerPause = true
                            if( this.rooms[messageData.room].timer)
                                clearInterval(this.rooms[messageData.room].timer)
                            this.rooms[messageData.room].timerStart = false
                            this.sendGame(this.rooms[messageData.room])
                            break

                        case 'timer_end':
                            this.eventTimerEnd(room)
                            break



                        case 'set_score':
                            // console.log(messageData)
                            // console.log(  this.rooms[messageData.room].score)
                            if(messageData.score){
                                messageData.score.forEach((scoreTeam)=>{
                                    if ( this.rooms[messageData.room].score[scoreTeam.teamCode]){
                                        this.rooms[messageData.room].score[scoreTeam.teamCode].current = scoreTeam.score
                                    } else{
                                        this.rooms[messageData.room].score[scoreTeam.teamCode] = {players:0, round:0, last: 0, current:scoreTeam.score, right:0, mistake:0, currentTime:0}
                                    }

                                })
                            }
                            this.sendScoreAdmin(this.rooms[room])
                            // this.sendScorePlayer(this.rooms[room])

                            break
                        case 'get_score':
                            this.sendScoreAdmin(this.rooms[room])
                            this.getScore( this.rooms[room], ws)
                            break
                        case 'view_score':
                            this.rooms[messageData.room].timerEnd=false
                            if( this.rooms[messageData.room].timer)
                                clearInterval(this.rooms[messageData.room].timer)
                            this.rooms[messageData.room].timerStart = false
                            this.rooms[messageData.room].timerPause = false
                            this.rooms[messageData.room].timerEnd = false
                            this.rooms[messageData.room].time = timeRound
                            const price = this.rooms[room].questions[this.rooms[room].currentTask].price*10
                            let rightAnswerPut = false
                            for (let i of Object.values(this.rooms[messageData.room].score) ){
                                let newScore = 0
                                if (i.right+i.mistake+(i.players - (i.right+i.mistake))>0)
                                    newScore = Math.round(price/(i.right+i.mistake+(i.players - (i.right+i.mistake)))*i.right)
                                i.current += newScore
                                if (i.isFirstTrue)
                                    i.current+=5
                                if (!rightAnswerPut && newScore>0)
                                    rightAnswerPut = true
                            }
                            // console.log('view_score',)
                            // console.log(rightAnswerPut)
                            if (!rightAnswerPut &&  this.rooms[messageData.room].stepRound !== 'additional' && this.rooms[room].questions[this.rooms[room].currentTask].textAdditional){
                                this.rooms[messageData.room].stepRound='additional'
                                for (let i of Object.values(this.rooms[messageData.room].score) ){
                                    i.isFirstTrue = false
                                    i.isFirstFalse = false
                                    i.right = 0
                                    i.mistake = 0
                                    i.currentTime=0
                                }
                                this.rooms[messageData.room].logAnswers[ this.rooms[messageData.room].currentTask] = {}

                                this.rooms[room].isFirstWrongAnswer = false
                                this.rooms[room].isFirstRightAnswer = false
                                this.rooms[room].firstTime = -1
                                this.sendGame(this.rooms[room])
                                this.sendScoreAdmin(this.rooms[room])
                            }else{
                                this.rooms[room].stepRound ='score'
                                this.sendScoreAdmin(this.rooms[room])
                                this.sendScorePlayer(this.rooms[room])
                            }
                            break
                        case 'answer':
                            //  console.log('answer',messageData)

                            if(!this.rooms[messageData.room].logAnswers[ this.rooms[messageData.room].currentTask])
                                this.rooms[messageData.room].logAnswers[ this.rooms[messageData.room].currentTask] = {}
                            if(!this.rooms[messageData.room].logAnswers[ this.rooms[messageData.room].currentTask][messageData.token])
                                this.rooms[messageData.room].logAnswers[ this.rooms[messageData.room].currentTask][messageData.token] = []

                            const playerTime = timeRound - this.rooms[messageData.room].time
                            if (!this.rooms[messageData.room].score[messageData.token]){
                                this.rooms[messageData.room].score[messageData.token] = {players:0, round:0, last:0, current:0, right:0, mistake:0, currentTime: playerTime}
                            }
                            // if ( this.rooms[messageData.room].score[messageData.token].round+1 === this.rooms[messageData.room].currentTask ){
                            //     this.rooms[messageData.room].score[messageData.token].round++
                            //     this.rooms[messageData.room].score[messageData.token].last = this.rooms[messageData.room].score[messageData.token].current
                            // }
                            // console.log('score',this.rooms[messageData.room].score[room])
                            if (this.rooms[room].questions[this.rooms[room].currentTask].answer.toLowerCase().trim().indexOf(messageData.answer.toLowerCase())>=0){
                                if(!this.rooms[room].isFirstRightAnswer || this.rooms[room].firstTime  === playerTime){

                                    this.rooms[room].isFirstRightAnswer = true
                                    this.rooms[room].firstTime = playerTime
                                    this.rooms[messageData.room].score[messageData.token].isFirstTrue = true

                                }

                                // this.rooms[messageData.room].score[room].last = this.rooms[messageData.room].score[room].current
                                // console.log (this.rooms[messageData.room].score[room])                        data.room.usersSockets.filter(us=>us.teamCode === teamCode.teamCode ).length
                                //  this.rooms[messageData.room].score[messageData.token].current += this.rooms[room].questions[this.rooms[room].currentTask].price*10/this.rooms[messageData.room].usersSockets.filter(us=>us.teamCode === messageData.token ).length
                                this.rooms[messageData.room].score[messageData.token].right+=1

                                this.rooms[messageData.room].logAnswers[ this.rooms[messageData.room].currentTask][messageData.token].push({answer:messageData.answer, id:messageData.userId, warning:false})

                            }else{
                                if(!this.rooms[room].isFirstWrongAnswer){
                                    this.rooms[room].isFirstWrongAnswer = true
                                    this.rooms[messageData.room].score[messageData.token].isFirstFalse = true
                                }
                                this.rooms[messageData.room].score[messageData.token].mistake+=1
                                this.rooms[messageData.room].logAnswers[ this.rooms[messageData.room].currentTask][messageData.token].push({answer:messageData.answer, id:messageData.userId, warning:true})
                            }
                            this.rooms[room].score[messageData.token].currentTime =  playerTime
                            this.rooms[messageData.room].score[messageData.token].players = this.rooms[messageData.room].usersSockets && this.rooms[messageData.room].usersSockets.filter(us=>us.teamCode === messageData.token )?this.rooms[messageData.room].usersSockets.filter(us=>us.teamCode === messageData.token ).length:0
                            // if(messageData.answer === this.rooms[messageData.room].questions[room.currentTask].answer)
                            //     console.log(messageData.answer, this.rooms[messageData.room].questions[room.currentTask] )
                            this.sendScoreAdmin(this.rooms[messageData.room])
                            break
                        case 'next':

                            this.rooms[messageData.room].stepRound='game'
                            this.rooms[messageData.room].currentTask++
                            //  console.log( this.rooms[messageData.room].currentTask)
                            // this.rooms[messageData.room].score[ this.rooms[messageData.room].currentTask] = {}
                            this.rooms[messageData.room].logAnswers[this.rooms[messageData.room].currentTask] = {}
                            this.rooms[room].isFirstWrongAnswer = false
                            this.rooms[room].isFirstRightAnswer = false
                            this.rooms[room].firstTime = -1




                            for (let i of Object.values(this.rooms[messageData.room].score) ){
                                i.round ++
                                //  i.current = Math.round(i.current)
                                i.last =  i.current
                                i.isFirstTrue = false
                                i.isFirstFalse = false
                                i.right = 0
                                i.mistake = 0
                                i.currentTime=0
                            }
                            this.sendScoreAdmin(this.rooms[room])
                            this.sendGame(this.rooms[room])
                            this.getScore( this.rooms[room], ws)
                            await this.saveProgress(this.rooms[messageData.room], messageData.room)
                            break
                    }

                });
                ws.on('close', ()=> {
                    if (! this.rooms[room]){
                        this.rooms[room] = {adminSocket:null,gameSocket:null, usersSockets:[] }
                    }
                    // console.log('disconnected', type)
                    switch (type) {
                        case 'admin':
                            //console.log("admin disconnect",this.rooms[room].adminSocket)
                            this.rooms[room].adminSocket = null
                            break
                        case 'game':
                            // console.log("client disconnect")
                            // this.rooms[room].gameSocket = null
                            this.rooms[room].isStart = false
                            break
                        case 'user':

                            if (this.rooms[room] && this.rooms[room].usersSockets)
                                this.rooms[room].usersSockets = this.rooms[room].usersSockets.filter(user=>user.id!==id)
                            break
                    }
                    // this.sendAdmin(this.rooms[room])
                    this.sendScoreAdmin(this.rooms[room])
                });
            });

        }catch (e) {
            console.log(e)
        }

    }

    eventTimerEnd(room){
        this.rooms[room].timerEnd=true
        clearInterval(this.rooms[room].timer)
        this.sendGame(this.rooms[room])
        // console.log('timer_stop')

    }

    sendTime(room){
        const message = {
            action:'time',

            isTimerEnd:room.timerEnd,
            isTimerStart:room.timerStart,
            time:room.time,

        }
        if(room.gameSocket)
            room.gameSocket.send(JSON.stringify(message) )
        if(room.adminSocket)
            room.adminSocket.send(JSON.stringify(message))
    }

    sendGame(room,  userId=-1, code=200){
        const message = {
            action:'game',
            warning:false,
            isStart: room.isStart,
            isFinish: room.isFinish,
            isTimerEnd:room.timerEnd,
            isTimerStart:room.timerStart,
            isTimerPause:room.timerPause,
            time:room.time,
            quiz: room.quiz,
            currentTask: room.currentTask,
            question: room.questions && [room.currentTask]?room.questions[room.currentTask]:[],
            session: room.session,
            score:room.score,
            stepRound:room.stepRound,
            code
        }
        if(userId>=0)
            message.userId=userId
        if(room.gameSocket) {
            room.gameSocket.send(JSON.stringify(message))
            // console.log("client is active")
        }
        if(room.adminSocket) {
            room.adminSocket.send(JSON.stringify(message))
            // console.log("admin is active")
        }
        room.usersSockets.forEach(us=>{
            //console.log(us)
            if (us.ws) {
                message.userId = us.id
                message.teamName = us.teamName
                message.isAnswer = !!(room.logAnswers[room.currentTask] && room.logAnswers[room.currentTask] && room.logAnswers[room.currentTask][us.teamCode] && room.logAnswers[room.currentTask][us.teamCode].find(team => team.id === us.id));

                us.ws.send(JSON.stringify(message))
            }
        })
    }


    sendScorePlayer(room) {
        if (!room)
            return
        const currentScores = room.logAnswers[room.currentTask]
        // console.log('sendScorePlayer')
        room.usersSockets.forEach(user=>{
            // if (!currentScores || !currentScores[user.teamCode])
            //     return

            const countTrue = currentScores && currentScores[user.teamCode]?currentScores[user.teamCode].filter(cs=>cs.warning === false).length:0
            const countFalse =  currentScores && currentScores[user.teamCode]? currentScores[user.teamCode].filter(cs=>cs.warning === true).length:0
            const countPlayers = room.usersSockets?room.usersSockets.filter(us=>us.teamCode === user.teamCode ).length:0
            // console.log(room.score[user.teamCode].current - room.score[user.teamCode].last)
            // console.log(room.score[user.teamCode])
            const score = room.score[user.teamCode]? Math.round(room.score[user.teamCode].current - room.score[user.teamCode].last):0
            // console.log( room.questions[room.currentTask])
            const answer = room.questions[room.currentTask].answer
            const message = {
                action:'score',
                score,
                countTrue,
                countFalse,
                countPlayers,
                answer

            }
            user.ws.send(JSON.stringify(message))
        })
        const adminMessage = {  action:'score', stepRound:room.stepRound}
        if(room.gameSocket)
            room.gameSocket.send(JSON.stringify(adminMessage) )
        if(room.adminSocket)
            room.adminSocket.send(JSON.stringify(adminMessage))

    }

    sendScoreAdmin(room){

        // console.log('sendScoreAdmin')
        try{
            const countsPlayerList = {}
            const countPlayerAnswer = {}

            if(!room )
                return
            if (room.teamsCode)
                room.teamsCode.forEach(teamCode =>{
                    countsPlayerList[teamCode.teamCode] = room.usersSockets.filter(us=>us.teamCode === teamCode.teamCode ).length
                    countPlayerAnswer[teamCode.teamCode] = room.logAnswers[room.currentTask]&&  room.logAnswers[room.currentTask][teamCode.teamCode ]?  room.logAnswers[room.currentTask][teamCode.teamCode ].length:0
                })
            const message = {
                warning:false,
                action:'score_admin',
                room:{
                    logAnswers: room.logAnswers,
                    currentTask: room.currentTask,
                    teamsCode: room.teamsCode,
                    countsPlayerList:countsPlayerList,
                    score:room.score,
                    countPlayerAnswer,
                    stepRound:room.stepRound
                }
            }

            if(room.gameSocket)
                room.gameSocket.send(JSON.stringify(message) )
            if(room.adminSocket)
                room.adminSocket.send(JSON.stringify(message))

        }catch (e) {
            console.log(e)
        }

    }

    sendErrorMessage(ws, codeError, description='',roomId, userId=-1){
        ws.send(JSON.stringify({warning:true, action:'error', session:roomId,message:description?description:'Ошибка сервера', code:codeError, userId}))
    }

    async getArchive(roomId){
        return await roomService.getRoomById(roomId)

    }

    getScore(room){
        const score = []
        // console.log('getScore')
        const teamsName = []
        if(room && room.teamsCode)
            room.teamsCode.forEach(team=>{
                teamsName.push(team.teamName)
                score.push(room.score[team.teamCode] && room.score[team.teamCode].last?room.score[team.teamCode].last:0)
            })
        const message = {warning:false,stepRound:room.stepRound, score, teamsName, action:'get_score'}
        if(room.gameSocket)
            room.gameSocket.send(JSON.stringify(message) )
        if(room.adminSocket)
            room.adminSocket.send(JSON.stringify(message))
        if (room.usersSockets)
            room.usersSockets.forEach(us=>{

                if (us.ws) {
                    us.ws.send(JSON.stringify(message))
                }
            })
    }

    getScoreWs(room, ws){
        const score = []
        // console.log('getScore')
        const teamsName = []
        if(room && room.teamsCode)
            room.teamsCode.forEach(team=>{
                teamsName.push(team.teamName)
                score.push(room.score[team.teamCode] && room.score[team.teamCode].last?room.score[team.teamCode].last:0)
            })

        ws.send(JSON.stringify({warning:false,stepRound:room.stepRound, score, teamsName, action:'get_score'}) )
    }


    finishSend(room){
        const score = []
        // console.log('getScore')

        const teamsName = []
        if(room && room.teamsCode)
            room.teamsCode.forEach(team=>{
                teamsName.push(team.teamName)
                score.push(room.score[team.teamCode] && room.score[team.teamCode].current?Math.round(room.score[team.teamCode].current):0)
            })
        const message = {warning:false,stepRound:'finish', score, teamsName, action:'get_score'}
        // console.log('finish',  this.rooms[messageData.room].stepRound)
        // console.log(  message)
        //console.log(message)
        if(room.gameSocket)
            room.gameSocket.send(JSON.stringify(message) )
        if(room.adminSocket)
            room.adminSocket.send(JSON.stringify(message))
        if (room.usersSockets)
            room.usersSockets.forEach(us=>{

                if (us.ws) {
                    us.ws.send(JSON.stringify(message))
                }
            })
    }


    async saveProgress(room, roomId){
        const res = await this.getArchive(roomId)
        if(!res.warning){
            const currentRoom = res.room
            currentRoom.progress = {}
            currentRoom.progress.isStart = room.isStart
            currentRoom.progress.isFinish =room.isFinish
            currentRoom.progress.score =room.score
            currentRoom.progress.logAnswers = room.logAnswers
            currentRoom.progress.currentTask = room.currentTask
            await roomService.updateRoom(currentRoom)
        }
    }
}

module.exports = new GameSocketController()