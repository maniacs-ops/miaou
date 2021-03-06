// md is short for "message display"
// Here are functions related to the display of messages in the chat and to the various message element lists

miaou(function(md, chat, gui, hist, locals, skin, time, usr){

	var renderers = [], unrenderers = [];

	// registers a function which will be called when a message needs rendering
	// Unless a renderer returns true, the other renderers will be called.
	// A renderer can be registered to be executed before the standard, markdown
	//  based, renderer, or after : set postrendering to true to register the
	//  renderer as a postrenderer (your renderer would then be able to use the
	//  result of the previous renderers including the default one.
	// If a renderer has nothing specific to do, it should do nothing and return
	//  undefined.
	// Arguments passed to your renderer are
	//  - $c : the div in which to render the message
	//  - the message
	//  - the previous version of the message if it's a replacement
	// If it's a re-rendering (message was edited, or voted, etc.) the $c div
	//  may be already rendered, even for the first renderer.
	// $c is already added to the dom, which means it's possible to test the
	//  parents if the rendering depends on it
	md.registerRenderer = function(fun, postrendering){
		renderers[postrendering?'push':'unshift'](fun);
	}
	md.registerUnrenderer = function(fun){
		unrenderers.unshift(fun);
	}
	md.render = function($content, message, oldMessage){
		if (oldMessage && message.content===oldMessage.content && $content.text().length) {
			return; // mainly to avoid removing boxed content
		}
		for (var i=0; i<renderers.length; i++) {
			if (renderers[i]($content, message, oldMessage)) break;
		}
	}
	md.unrender = function($content, message){
		for (var i=0; i<unrenderers.length; i++) {
			if (unrenderers[i]($content, message)) break;
		}
	}

	// used for rerendering, for example on resizing or sliding
	$.fn.renderMessages = function(){
		var $messages = $('.message', this).add(this).filter('.message');
		$messages.each(function(){
			var	$m = $(this),
				m = $m.dat('message'),
				$c = $m.find('.content');
			md.render($c, m);
		});
	}


	md.votesAbstract = function(message){
		return chat.voteLevels.map(function(l){
			return message[l.key] ? '<span class="vote '+l.key+'">'+message[l.key]+' '+l.icon+'</span>' : '';
		}).join('');
	}

	md.getMessages = function(){
		return $('#messages .message').map(function(){ return $(this).dat('message') }).get();
	}

	md.getMessage = function(mid){
		var $message = $('#messages .message[mid='+mid+']');
		if ($message.length) return $message.eq(0).dat('message');
	}

	// used for notable messages and search results
	md.showMessages = function(messages, $div, append){
		if (!append) $div.empty();
		var notable = $div[0].id==="notable-messages"; // not very pretty...
		for (var i=0; i<messages.length; i++) {
			var $md = md.addSideMessageDiv(messages[i], $div);
			if (notable) {
				chat.trigger("notable", messages[i], $md);
			}
		}
	}

	// builds the message div and append it to the container, managing resizing.
	// May be used for notable messages and search results
	md.addSideMessageDiv = function(m, $div, $repl){
		var	$content = $('<div>').addClass('content');
		var $md = $('<div>').addClass('message').dat('message', m).append($content).append(
			$('<div>').addClass('nminfo')
			.html(md.votesAbstract(m) + ' ' + time.formatTime(m.created) + ' by ' + m.authorname)
		);
		if (m.author===locals.me.id) $md.addClass('me');
		if ($repl) {
			$repl.replaceWith($md);
			chat.trigger("notable", m, $md);
		}
		else $md.appendTo($div);
		if (m.id) $md.attr('mid', m.id);
		$md.addClass(m.pin ? 'pin' : 'star');
		md.render($content, m);
		if ($content.height()>80) {
			$content.addClass("closed");
			$md.append('<div class=opener>');
		}
		return $md;
	}

	// if the message is present among notable ones, we replace the div
	//  with the new version
	md.updateNotableMessage = function(m){
		var	$container = $('#notable-messages'),
			$repl = $container.children('.message[mid='+m.id+']');
		if ($repl.length) md.addSideMessageDiv(m, $container, $repl);
	}

	// the passed upd object contains
	//  ids : sorted ids of notable messages
	//  m : optional message which is entering the list
	md.updateNotableMessages = function(upd){
		var	$container = $('#notable-messages'),
			mmap = {};
		$container.find('.message').each(function(){
			var m = $(this).dat('message');
			mmap[m.id] = m;
		});
		if (upd.m) mmap[upd.m.id] = upd.m;
		$container.empty();
		upd.ids.forEach(function(id){
			var m = mmap[id];
			if (!m) return console.log("No message in notables for id ", id);
			var $md = md.addSideMessageDiv(m, $container);
			chat.trigger("notable", m, $md);
		});
	}

	md.showError = function(error){
		console.log('ERROR', error);
		if (typeof error === 'string') error = {txt:error};
		$('<div>').addClass('error').append(
			$('<div>').addClass('user error').append("<span>Miaou</span>")
		).append(
			$('<div>').addClass('content').text(error.txt || "an error occured - connection might be damaged")
		).appendTo('#messages');
		if (error.mc && !$('#input').val()) !$('#input').val(error.mc);
		gui.scrollToBottom();
	}

	// builds a notification message with a close button. The fill callback
	//  is passed the container and a close function
	md.notificationMessage = function(fill){
		var	notification = {closelisteners:[]},
			wab = gui.isAtBottom(),
			$md = notification.$md = $('<div>').addClass('notification');
		$md.appendTo('#notifications').dat('notification', notification);
		notification.remove = function(f){
			if (typeof f === "function") {
				notification.closelisteners.push(f);
			} else {
				while ((f = notification.closelisteners.shift())) f();
				$md.remove();
			}
			return this;
		}
		$md.append($('<button>').addClass('remover').text('X').click(notification.remove));
		fill($md, notification.remove);
		if (wab) gui.scrollToBottom();
		return notification;
	}

	function resizeUser($u){
		$u.removeClass('size0 size1 size2 size3 size4');
		$u.addClass('size'+Math.min($u.height()/22|0, 4));
	}

	// checks immediately and potentially after image loading that
	//  the message div isn't greater than authorized
	function resize($md, wasAtBottom){
		var $content = $md.find('.content');
		var resize = function(){
			$content.removeClass("closed");
			$md.removeClass('has-opener');
			$md.find('.opener,.closer').remove();
			if ($content.height()>158) {
				$content.addClass("closed");
				$md.addClass("has-opener").append('<div class=opener>');
			}
			if (wasAtBottom) gui.scrollToBottom();
		}
		resize();
		$content.find('img').imgOn('load', resize);
	}

	// resizes all messages. This must be called each time a container of
	//  .message elements change width.
	md.resizeAll = function(){
		var	todo = [],
			wasAtBottom = gui.isAtBottom(),
			$messages = $('.message');
		$messages.find('.closed').removeClass('closed');
		$messages.find('.opener').remove();
		$messages.each(function(){
			var $md = $(this),
				$content = $md.find('.content'),
				h = $content.height();
			if (h>158) todo.push({$md:$md, $content:$content});
		});
		todo.forEach(function(t){
			t.$md.append('<div class=opener>');
			t.$content.addClass("closed").height();
		});
		$messages.find('.user').each(function(){
			resizeUser($(this));
		});
		if (wasAtBottom) gui.scrollToBottom();
	}

	md.updateLoaders = function(){
		$('.olderLoader,.newerLoader').remove();
		var 	i,
			idmap = {},
			$messages = $('#messages .message'),
			messages = [],
			m;
		for (i=0; i<$messages.length; i++) {
			messages.push(m = $messages.eq(i).dat('message'));
			if (m.id) idmap[m.id] = 1;
		}
		for (i=0; i<$messages.length; i++) {
			m = messages[i];
			if (m.prev) {
				if (idmap[m.prev]) {
					m.prev = 0;
				} else {
					$('<div>').addClass('olderLoader').attr('mid', m.prev).text("load older messages")
					.insertBefore($messages.eq(i).closest('.user-messages'));
				}
			}
			if (m.next) {
				if (idmap[m.next]) {
					m.next = 0;
				} else {
					$('<div>').addClass('newerLoader').attr('mid', m.next).text("load newer messages")
					.insertAfter($messages.eq(i).closest('.user-messages'));
				}
			}
		}
	}

	function selfHide(){
		this.style.visibility="hidden";
	}

	// builds a new .user-messages div for the passed user)
	function usermessagesdiv(user){
		var	$usermessages = $('<div>').addClass('user-messages').dat('user', user),
			$user = $('<div>').addClass('user').appendTo($usermessages),
			avsrc = usr.avatarsrc(user);
		$user.css('color', skin.stringToColour(user.name)).append($('<span/>').text(user.name));
		if (avsrc) {
			$('<div>').addClass('avatar-wrapper').prependTo($user).append(
				$('<img>').attr('src', avsrc).addClass('avatar').imgOn('error', selfHide)
			);
		} else {
			$('<div>').addClass('avatar').prependTo($user);
		}
		if (user.bot) $user.addClass('bot');
		if (user.id===locals.me.id) $usermessages.addClass('me');
		return $usermessages;
	}

	// inserts or updates a message in the main #messages div
	md.addMessage = function(message, shouldStickToBottom){
		var	messages = md.getMessages(),
			oldMessage,
			insertionIndex = messages.length - 1, // -1 : insert at begining, i>=0 : insert after i
			//~ wasAtBottom = gui.isAtBottom(),
			$md = $('<div>').addClass('message').dat('message', message),
			$decorations = $('<div>').addClass('decorations').appendTo($md),
			$mc,
			user = { id:message.author, name:message.authorname, avs:message.avs, avk:message.avk },
			votesHtml = md.votesAbstract(message);
		if (message.bot) user.bot = true;
		if (message.id) {
			$md.attr('mid', message.id);
			for (var i=messages.length; i--;) {
				if (messages[i].id===message.id) {
					oldMessage = messages[insertionIndex = i];
					break;
				}
			}
			if (!oldMessage) {
				if (
					messages.length===0
					|| message.id<messages[0].id
					|| message.created<messages[0].created
				) {
					insertionIndex = -1;
					// the following line because of the possible special case of a
					//  pin vote being removed by somebody's else
					if (message.vote && !message[message.vote]) delete message.vote; // fixme ???
				} else {
					while ( insertionIndex && (
						messages[insertionIndex].id>message.id
						|| messages[insertionIndex].created>message.created
					) ) {
						insertionIndex--;
					}
				}
			}
		}
		message.repliesTo = 0;
		if (message.content) {
			// Updates the link (as reply) to upwards messages
			// To make things simpler, we consider only one link upwards
			var matches = message.content.match(/^\s*@\w[\w\-]{2,}#(\d+)/);
			if (matches) message.repliesTo = +matches[1];
		}
		usr.insert(user, message.changed||message.created);
		if (message.authorname===locals.me.name) {
			$md.addClass('me');
			$('.error').remove();
		}
		var	$previousmessageset,
			$nextmessageset,
			noEndOfBatch =  !message.prev && !message.next;
		if (~insertionIndex) {
			if (oldMessage) {
				if (message.vote === '?') {
					message.vote = oldMessage.vote;
				}
				if (message.content === oldMessage.content) {
					// we take the old message content,
					// so as not to lose the possible replacements (e.g. boxing)
					$mc = $('#messages .message[mid='+message.id+'] .content');
				} else if (message.changed !== oldMessage.changed) {
					message.previous = oldMessage;
				}
				$('#messages .message').eq(insertionIndex).replaceWith($md);
			} else {
				$previousmessageset = $('#messages .message').eq(insertionIndex).closest('.user-messages');
				if (
					$previousmessageset.dat('user').id===user.id && noEndOfBatch
					&& !$previousmessageset.find('> .message').last().dat('message').next
				) {
					$previousmessageset.append($md);
				} else {
					$nextmessageset = $('#messages .message').eq(insertionIndex+1).closest('.user-messages');
					if (
						$nextmessageset.length && $nextmessageset.dat('user').id===user.id && noEndOfBatch
						&& !$nextmessageset.find('> .message').first().dat('message').prev
					) {
						$nextmessageset.prepend($md);
					} else {
						$previousmessageset.after(usermessagesdiv(user).append($md));
					}
				}
			}
		} else {
			$nextmessageset = $('#messages .user-messages').first();
			if (
				$nextmessageset.length && $nextmessageset.dat('user').id===user.id && noEndOfBatch
				&& !$nextmessageset.find('> .message').first().dat('message').prev
			) {
				$nextmessageset.prepend($md);
			} else {
				usermessagesdiv(user).append($md).prependTo('#messages');
			}
		}
		if (message.content && message.changed) {
			var $pen = $('<div>&#xe817;</div>') // fontello icon-pencil
			.addClass('decoration pen').appendTo($decorations);
			if (message.previous) $pen.addClass('clickable').attr('title', 'Click for message history');
		}
		if (!message.id) {
			var desc = "only sent to people currently in the room, and will disappear if you refresh the page";
			$('<div>&#xe82d;</div>') // fontello icon-snow
			.appendTo($decorations)
			.addClass('decoration snap')
			.attr('title', "Flake : "+desc);
		}
		if (votesHtml.length) $md.append($('<div/>').addClass('message-votes').html(votesHtml));
		if (!$mc) $mc = $('<div>').addClass('content');
		$mc.appendTo($md);
		md.render($mc, message, oldMessage);
		if (!gui.mobile && locals.userPrefs.datdpl!=="hover") {
			var $mdate = $('<div>').addClass('mdate').text(time.formatTime(message.created)).appendTo($md);
			if (locals.userPrefs.datdpl!=="always") $mdate.hide();
		}
		resize($md, shouldStickToBottom);
		resizeUser($md.siblings('.user'));
		if (shouldStickToBottom && (!message.id || message.id==$('#messages .message').last().attr('mid'))) {
			gui.scrollToBottom($md);
		}
		return $md;
	}

	md.showMessageFlowDisruptions = function(){
		var	$messages = $('#messages .message'),
			lastMessage, $lastMessage;
		$messages.find('.before-disrupt').removeClass('before-disrupt');
		$messages.find('.after-disrupt').removeClass('after-disrupt');
		for (var i=0; i<$messages.length; i++) {
			var	$message = $messages.eq(i),
				message = $message.dat('message');
			if (lastMessage && message.created-lastMessage.created > miaou.chat.DISRUPTION_THRESHOLD) {
				$lastMessage.addClass('before-disrupt');
				$message.addClass('after-disrupt');
				if (locals.userPrefs.datdpl==="on_breaks" && !gui.mobile) {
					$messages.eq(i-1).add($message).find('.mdate').show();
				}
			}
			lastMessage = message;
			$lastMessage = $message;
		}
	}

	// replaces one line of a message
	md.box = function(args){
		var $from = $('<div>'+miaou.fmt.mdTextToHtml(args.from)+'</div>'),
			$m = $('.message[mid='+args.mid+']'),
			wab = gui.isAtBottom();
		try {
			$m.find('.content').addClass('wide').html(function(_, h){
				return h.replace(
					$from.html(),
					'<div class=box'+(args.class ? (' class='+args.class) : '')+'>'+args.to+'</div>'
				);
			}).find('a[href]').attr('target', '_blank');
			resize($m, wab);
		} catch (e) {
			console.log("boxing failed", args);
		}
	}

});
