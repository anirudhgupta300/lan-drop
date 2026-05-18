const { WebSocketServer, WebSocket } = require('ws')

const wss = new WebSocketServer({ port: 8080 })
const rooms = new Map()

wss.on('connection', function connection(ws) {
    ws.on('error', console.error);
    ws.on('message', function message(data){
        console.log('received %s', data);
        const received_data = JSON.parse(data.toString())
        if (received_data.type == 'join'){
            const existing = rooms.get(received_data.room) || [];
            existing.push(ws);
            rooms.set(received_data.room, existing);
            if(existing.length == 2){
                existing[0].send(JSON.stringify({type: 'ready'}));
            }
        } else if(
            received_data.type == 'offer' ||
            received_data.type == 'answer' ||
            received_data.type == 'ice'
        ){
            const curr_room = rooms.get(received_data.room);
            const other = curr_room?.find(socket => socket !== ws);
            if(other && other.readyState == WebSocket.OPEN){
                other.send(JSON.stringify(received_data));
            }
        }
    });
});

console.log('Signaling server running on ws://localhost:8080')